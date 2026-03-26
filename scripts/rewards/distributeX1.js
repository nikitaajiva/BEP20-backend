"use strict";

// scripts/rewards/distributeX1.js

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const moment = require("moment");
const connectDB = require("../../config/db");

const LedgerRow = require("../../models/LedgerRow");
const User = require("../../models/User");
const Ledger = require('../../models/Ledger');
const Level = require("../../models/Level");
const DailyUserLp = require("../../models/DailyUserLp");
let progressCounter = 0;
let progressStartTime = Date.now();

const {
  X_TIERS,
  awardXBonus_StoreOnly,
} = require("../../jobs/eventHandlers/x1Handler");

/* =========================================================
   SIMPLE CONCURRENCY POOL (SAFE)
========================================================= */
async function processWithConcurrency(items, worker, concurrency = 3) {
  let index = 0;
  const results = [];

  async function runner() {
    while (true) {
      const i = index++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
      progressCounter++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runner));
  return results;
}

/* =========================================================
   PRELOAD X-RANK USERS (ONLY ~116 USERS)
========================================================= */
async function preloadXRankUsers() {
  const users = await User.find(
    { xRank: { $in: ["X1", "X2", "X3", "X4", "X5"] } },
    { _id: 1, uhid: 1, xRank: 1 }
  ).lean();

  const map = new Map();
  users.forEach((u) => map.set(u.uhid, u));

  console.log(`✅ Preloaded ${map.size} X-Rank users`);
  return map;
}

/* =========================================================
   DAILY LP CACHE (VERY IMPORTANT)
========================================================= */
const dailyLpCache = new Map();

async function getDailyLp(uhid, startOfDay, endOfDay) {
  const key = `${uhid}-${startOfDay.toISOString()}`;
  if (dailyLpCache.has(key)) return dailyLpCache.get(key);

  const lp = await DailyUserLp.findOne({
    uhid,
    date: { $gte: startOfDay, $lte: endOfDay },
  }).lean();

  dailyLpCache.set(key, lp || null);
  return lp;
}

/* =========================================================
   UNBOUNDED UPLINE TRAVERSAL (SAFE)
========================================================= */
/**
 * DEBUG + FINAL VERSION
 * Builds full parent chain, matches X-Rank users, returns qualified uplines
 */

async function getQualifiedUplineChain(
  startingUhid,
  eventDate,
  xRankUserMap
) {
  const MAX_FAILSAFE_DEPTH = 200; // safety only
  const MAX_REWARD_LEVEL = 16;    // business rule

  const startOfDay = new Date(eventDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const visited = new Set();
  const parentChain = [];

  let currentUhid = startingUhid;
  let depth = 0;

  /* -------------------------------
     1️⃣ BUILD FULL PARENT CHAIN
  --------------------------------*/
  while (currentUhid && depth < MAX_FAILSAFE_DEPTH) {
    if (visited.has(currentUhid)) {
      console.warn("⚠️ Circular reference detected at", currentUhid);
      break;
    }
    visited.add(currentUhid);

    const level = await Level.findOne({ child: currentUhid })
      .sort({ level: 1 })
      .lean();

    if (!level?.parent) break;

    depth++;

    parentChain.push({
      uhid: level.parent,
      depth,
    });

    currentUhid = level.parent;
  }

  /* -------------------------------
     2️⃣ MATCH AGAINST X-RANK MAP
  --------------------------------*/
  const xRankMatches = parentChain
    .filter(p => xRankUserMap.has(p.uhid))
    .map(p => {
      const xUser = xRankUserMap.get(p.uhid);
      return {
        user: xUser,
        depth: p.depth,
        rewardLevel: Math.min(p.depth, MAX_REWARD_LEVEL),
        tier: xUser.xRank,
      };
    });

  /* -------------------------------
     🔍 DEBUG LOGS (VERY IMPORTANT)
  --------------------------------*/
  // console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  // console.log("🔎 Depositor:", startingUhid);
  // console.log(
  //   "📜 Parent chain:",
  //   parentChain.map(p => `${p.uhid}@${p.depth}`)
  // );
  // console.log(
  //   "🎯 X-Rank hits:",
  //   xRankMatches.length
  //     ? xRankMatches.map(
  //         m => `${m.user.uhid} (${m.tier}) depth=${m.depth}`
  //       )
  //     : "NONE"
  // );
  // console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  /* -------------------------------
     3️⃣ CHECK DAILY LP & BUILD RESULT
  --------------------------------*/
  const qualifiedUplines = [];

for (const m of xRankMatches) {
  // Fetch counters only
  const uplineUser = await User.findOne(
    { uhid: m.user.uhid },
    {
      "counters.selfLp": 1,
      "counters.totalTeamLp": 1,
    }
  ).lean();

  const selfLp = Number(uplineUser?.counters?.selfLp || 0);
  const teamLp = Number(uplineUser?.counters?.totalTeamLp || 0);

  const tierConfig = X_TIERS[m.tier];

  if (!tierConfig) {
    console.log(`⛔ Unknown X-Rank ${m.tier} for ${m.user.uhid}`);
    continue;
  }

  // // 🔒 ELIGIBILITY CHECK (FROM X_TIERS)
  // if (
  //   selfLp < tierConfig.selfLP ||
  //   teamLp < tierConfig.teamLP
  // ) {
  //   // console.log(
  //   //   `⛔ X-Rank ${m.user.uhid} (${m.tier}) NOT eligible | ` +
  //   //   `SelfLP ${selfLp}/${tierConfig.selfLP}, ` +
  //   //   `TeamLP ${teamLp}/${tierConfig.teamLP}`
  //   // );
  //   continue;
  // }

  // ✅ ELIGIBLE — reward allowed
  qualifiedUplines.push({
    user: m.user,
    qualification: {
      tier: m.tier,
      rate: tierConfig.rate, // 🔥 SAME SOURCE
    },
    level: m.rewardLevel,   // capped earlier at 16
    selfLp,
    teamLp,
  });

  // console.log(
  //   `✅ X-Rank ${m.user.uhid} (${m.tier}) ELIGIBLE | ` +
  //   `Rate ${tierConfig.rate * 100}% | ` +
  //   `SelfLP ${selfLp}, TeamLP ${teamLp}, Level ${m.rewardLevel}`
  // );
}




  return qualifiedUplines;
}



/* =========================================================
   STORE-ONLY X1 DISTRIBUTION (NO LEDGER WRITE)
========================================================= */
// async function handleX1_StoreOnly({
//   depositor,
//   qualifiedUplines,
//   depositAmount,
//   triggeringEventId,
//   eventTs,
// }) {
//   let totalRate = 0;

//   const first = qualifiedUplines[0];
//   totalRate += await awardXBonus_StoreOnly({
//     uplineUser: first.user,
//     depositor,
//     depositAmount,
//     rate: first.qualification.rate,
//     triggeringEventId,
//     tier: first.qualification.tier,
//     level: first.level,
//     eventTs,
//   });

//   for (let i = 1; i < qualifiedUplines.length; i++) {
//     const curr = qualifiedUplines[i];
//     const prev = qualifiedUplines[i - 1];
//     const diff = Math.max(0, curr.qualification.rate - prev.qualification.rate);

//     if (totalRate + diff > 0.5) {
//       const remaining = 0.5 - totalRate;
//       if (remaining > 0) {
//         await awardXBonus_StoreOnly({
//           uplineUser: curr.user,
//           depositor,
//           depositAmount,
//           rate: remaining,
//           triggeringEventId,
//           tier: curr.qualification.tier,
//           level: curr.level,
//           eventTs,
//         });
//       }
//       break;
//     }

//     if (diff > 0) {
//       totalRate += await awardXBonus_StoreOnly({
//         uplineUser: curr.user,
//         depositor,
//         depositAmount,
//         rate: diff,
//         triggeringEventId,
//         tier: curr.qualification.tier,
//         level: curr.level,
//         eventTs,
//       });
//     }
//   }
// }
async function handleX1_StoreOnly({
  depositor,
  qualifiedUplines,
  depositAmount,
  triggeringEventId,
  eventTs,
}) {
  let totalRate = 0;

  for (let i = 0; i < qualifiedUplines.length; i++) {
    const curr = qualifiedUplines[i];
    const prev = qualifiedUplines[i - 1];

    const rate =
      i === 0
        ? curr.qualification.rate
        : Math.max(0, curr.qualification.rate - prev.qualification.rate);

    if (rate <= 0) continue;

    /* =================================================
       🔒 5× CAP CHECK — THIS IS THE CAP
    ================================================= */
    const ledger = await Ledger.findOne(
      { userId: curr.user._id },
      {
        "limits.fiveXLimit.used": 1,
        "wallets.lp": 1,
      }
    ).lean();

    const lpBalance = Number(ledger?.wallets?.lp || 0);
    const fiveXUsed = Number(ledger?.limits?.fiveXLimit?.used || 0);

    const FIVE_X_MULTIPLIER = 5;
    const fiveXMax = lpBalance * FIVE_X_MULTIPLIER - fiveXUsed;

    // ❌ USER ALREADY EXCEEDED 5× — NO REWARD
    if (fiveXMax <= 0) {
      continue; // ⛔ awardXBonus_StoreOnly is NEVER called
    }

    // 🎯 CAP THIS REWARD
    const maxAllowedRate = fiveXMax / Number(depositAmount);
    const finalRate = Math.min(rate, maxAllowedRate);

    if (finalRate <= 0) continue;

    /* =================================================
       🌐 GLOBAL 50% CAP (existing logic)
    ================================================= */
    if (totalRate + finalRate > 0.5) {
      const remaining = 0.5 - totalRate;
      if (remaining <= 0) break;

      await awardXBonus_StoreOnly({
        uplineUser: curr.user,
        depositor,
        depositAmount,
        rate: remaining,
        triggeringEventId,
        tier: curr.qualification.tier,
        level: curr.level,
        eventTs,
      });

      break;
    }

    await awardXBonus_StoreOnly({
      uplineUser: curr.user,
      depositor,
      depositAmount,
      rate: finalRate,
      triggeringEventId,
      tier: curr.qualification.tier,
      level: curr.level,
      eventTs,
    });

    totalRate += finalRate;
  }
}


/* =========================================================
   MAIN DISTRIBUTION FUNCTION
========================================================= */
async function distributeX1(options = {}) {
  const isDryRun = options.dryRun || false;
  const concurrency = options.concurrency || 3;
let fromDate;
let toDate;

// -------------------------------------------------
// ✅ DEFAULT: PREVIOUS UTC DAY ONLY
// -------------------------------------------------
if (!options.fromDate && !options.toDate) {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const yesterdayUTC = new Date(todayUTC);
  yesterdayUTC.setUTCDate(todayUTC.getUTCDate() - 1);

  fromDate = yesterdayUTC;
  toDate = new Date(todayUTC.getTime() - 1); // 23:59:59.999 of yesterday
} else {
  fromDate = options.fromDate
    ? moment.utc(options.fromDate).startOf("day").toDate()
    : null;

  toDate = options.toDate
    ? moment.utc(options.toDate).endOf("day").toDate()
    : null;
}


  console.log("==========================================");
  console.log(`Mode        : ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Concurrency : ${concurrency}`);
  if (fromDate) console.log(`From date   : ${fromDate.toISOString()}`);
  if (toDate) console.log(`To date     : ${toDate.toISOString()}`);
  console.log("==========================================");

  await connectDB();
  console.log("✅ MongoDB connected");

  const xRankUserMap = await preloadXRankUsers();
  
  const query = {
    eventType: "DAILY_REWARDS_LP",
    $or: [{ x1Processed: { $exists: false } }, { x1Processed: false }],
  };

  if (fromDate || toDate) {
    query.ts = {};
    if (fromDate) query.ts.$gte = fromDate;
    if (toDate) query.ts.$lte = toDate;
  }

  let events = await LedgerRow.find(query).sort({ ts: 1 }).lean();
 if (options.limit) {
  events = events.slice(0, options.limit);
  console.log(`⚠️ LIMIT ENABLED: Processing only ${events.length} events`);
} else {
  console.log(`📦 Found ${events.length} events to process`);
}

progressCounter = 0;
progressStartTime = Date.now();
startProgressLogger(events.length);

  const updates = await processWithConcurrency(
    events,
    async (event) => {
      const depositor = await User.findById(event.userId).lean();
   
      if (!depositor) return null;

      const uplines = await getQualifiedUplineChain(
        depositor.uhid,
        event.ts,
        xRankUserMap
      );

      if (uplines.length && !isDryRun) {
        await handleX1_StoreOnly({
          depositor,
          qualifiedUplines: uplines,
          depositAmount: event.amount.toString(),
          triggeringEventId: event._id.toString(),
          eventTs: event.ts,
        });
      }

      return {
        updateOne: {
          filter: { _id: event._id },
          update: { $set: { x1Processed: true } },
        },
      };
    },
    concurrency
  );

  if (!isDryRun) {
    const ops = updates.filter(Boolean);
    if (ops.length) {
      await LedgerRow.bulkWrite(ops, { ordered: false });
      console.log(`✅ Marked ${ops.length} events as x1Processed`);
    }
  }

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected");
  console.log("✅ X1 distribution completed");
}

/* =========================================================
   CLI ARGUMENT PARSER + RUNNER
========================================================= */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    fromDate: null,
    toDate: null,
    concurrency: 3,
    limit:null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--from-date":
        options.fromDate = args[++i];
        break;
      case "--to-date":
        options.toDate = args[++i];
        break;
      case "--concurrency":
        options.concurrency = parseInt(args[++i], 10);
        break;
      case "--limit":
        options.limit = parseInt(args[++i], 10);
        break;

    }
  }
  return options;
}

if (require.main === module) {
  const options = parseArgs();
  distributeX1(options)
    .then(() => {
      console.log("🎉 Script finished successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Script failed:", err);
      process.exit(1);
    });
}

function startProgressLogger(total) {
  const interval = setInterval(() => {
    const done = progressCounter;
    const elapsedMs = Date.now() - progressStartTime;
    const elapsedSec = elapsedMs / 1000;

    const rate = elapsedSec > 0 ? (done / elapsedSec).toFixed(1) : 0;
    const remaining = total - done;
    const etaSec = rate > 0 ? Math.ceil(remaining / rate) : 0;

    const pct = total > 0 ? ((done / total) * 100).toFixed(2) : "0.00";

    console.log(
      `⏳ Progress: ${done}/${total} (${pct}%) | ⚡ ${rate}/sec | 🕒 ETA ~${etaSec}s`
    );

    if (done >= total) {
      clearInterval(interval);
    }
  }, 5000); // 🔥 logs every 5 seconds (safe)
}

module.exports = { distributeX1 };
