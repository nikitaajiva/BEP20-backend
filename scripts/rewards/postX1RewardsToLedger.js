"use strict";

/**
 * scripts/rewards/postX1RewardsToLedger.js
 *
 * Phase 2:
 * - Aggregate X1 rewards per user (DATE-WISE)
 * - Post totals to Ledger ONCE per user
 * - Mark rewards as posted
 * - Create LedgerRow for X_BONUS_REWARD
 * - Enforce 5× cap strictly
 * - Dry-run supported
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../../config/db");

const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const X1Reward = require("../../models/X1Reward");

const {
  addDecimal128,
  ensureDecimal128,
} = require("../../utils/decimal128Utils");

function d128ToNumber(d) {
  return parseFloat(d?.toString?.() || "0");
}

/* =========================================================
   PROGRESS TRACKER
========================================================= */
let progressCounter = 0;
let progressStartTime = Date.now();

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
      `⏳ Progress: ${done}/${total} (${pct}%) | ⚡ ${rate}/users | 🕒 ETA ~${etaSec}s`
    );

    if (done >= total) clearInterval(interval);
  }, 5000);
}

/* =========================================================
   MAIN FUNCTION
========================================================= */
async function postX1RewardsToLedger(options = {}) {
  const isDryRun = options.dryRun || false;

  /* -----------------------------------------
     DATE RESOLUTION (DEFAULT = TODAY UTC)
  ------------------------------------------ */
  let date = options.date;

  if (!date) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    date = `${yyyy}-${mm}-${dd}`;
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  console.log("==========================================");
  console.log(`Mode      : ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Post Date : ${date} (UTC)`);
  console.log("==========================================");

  await connectDB();
  console.log("✅ MongoDB connected");

  /* -----------------------------------------
     AGGREGATE DATE-WISE UNPOSTED REWARDS
  ------------------------------------------ */
  const aggregates = await X1Reward.aggregate([
    {
      $match: {
        postedToLedger: { $ne: true },
        ts: { $gte: dayStart, $lte: dayEnd },
      },
    },
    {
      $group: {
        _id: "$userId",
        totalAmount: { $sum: "$amount" },
        rewardIds: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
  ]);

  console.log(`📦 Found ${aggregates.length} users with X1 rewards`);

  if (!aggregates.length) {
    console.log("ℹ️ Nothing to post. Exiting.");
    await mongoose.disconnect();
    return;
  }

  progressCounter = 0;
  progressStartTime = Date.now();
  startProgressLogger(aggregates.length);

  /* -----------------------------------------
     PROCESS EACH USER
  ------------------------------------------ */
  for (const row of aggregates) {
    const { _id: userId, totalAmount, rewardIds, count } = row;
    const safeTotal = ensureDecimal128(totalAmount);

    /* ---------- DRY RUN ---------- */
    if (isDryRun) {
      console.log("--------------------------------------------------");
      console.log(`👤 UserId   : ${userId}`);
      console.log(`🧾 Entries  : ${count}`);
      console.log(`💰 Total    : ${safeTotal.toString()}`);
      console.log("--------------------------------------------------");
      progressCounter++;
      continue;
    }

    /* ---------- LIVE RUN ---------- */
    const ledger = await Ledger.findOne({ userId });
    if (!ledger) {
      console.warn(`⚠️ Ledger not found for user ${userId}`);
      progressCounter++;
      continue;
    }

    /* =====================================================
       🚫 5× CAP PROTECTION (ONLY LOGIC CHANGE)
    ===================================================== */
    const fiveXCap = parseFloat(ledger.limits?.fiveXLimit?.cap || 0);
    const fiveXUsed = parseFloat(ledger.limits?.fiveXLimit?.used || 0);

    if (fiveXCap > 0 && fiveXUsed >= fiveXCap) {
      console.log(
        `🚫 SKIPPED (5× cap reached) userId=${userId} | used=${fiveXUsed} | cap=${fiveXCap}`
      );
      progressCounter++;
      continue;
    }

    let creditAmount = safeTotal;

    if (fiveXCap > 0) {
      const remaining = fiveXCap - fiveXUsed;

      if (remaining <= 0) {
        progressCounter++;
        continue;
      }

      if (parseFloat(safeTotal.toString()) > remaining) {
        creditAmount = ensureDecimal128(remaining);
        console.log(
          `⚠️ PARTIAL CREDIT userId=${userId} | credited=${creditAmount.toString()}`
        );
      }
    }

    /* ---------------- WALLET UPDATES ---------------- */
    ledger.wallets.xBonus = addDecimal128(
      ledger.wallets.xBonus,
      creditAmount
    );

    ledger.wallets.communityRewards = addDecimal128(
      ledger.wallets.communityRewards,
      creditAmount
    );

    ledger.wallets.dailyXBonus = addDecimal128(
      ledger.wallets.dailyXBonus,
      creditAmount
    );

    ledger.totalRewardsCredited = addDecimal128(
      ledger.totalRewardsCredited,
      creditAmount
    );

    ledger.limits.fiveXLimit.used = addDecimal128(
      ledger.limits.fiveXLimit.used,
      creditAmount
    );

    await ledger.save();

    /* ---------------- LEDGERROW ENTRY ---------------- */
    await LedgerRow.create({
      userId,
      eventType: "X_BONUS_REWARD",
      walletFrom: "SYSTEM",
      walletTo: "COMMUNITY_REWARDS",
      amount: mongoose.Types.Decimal128.fromString(
        d128ToNumber(creditAmount).toFixed(6)
      ),
      narrative: "Daily X bonus",
      cascadeProcessed: true,
      positioningBonusProcessed: false,
      communityBoosterProcessed: true,
      status: "INITIATED",
    });

    /* ---------------- MARK AS POSTED ---------------- */
    await X1Reward.updateMany(
      { _id: { $in: rewardIds } },
      {
        $set: {
          postedToLedger: true,
          postedAt: new Date(),
        },
      }
    );

    progressCounter++;
  }

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected");
  console.log(
    `✅ X1 rewards posting ${isDryRun ? "DRY RUN" : "LIVE"} completed`
  );
}

/* =========================================================
   CLI ARGUMENT PARSER
========================================================= */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    date: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--date":
        options.date = args[++i];
        break;
    }
  }

  return options;
}

/* =========================================================
   RUNNER
========================================================= */
if (require.main === module) {
  const options = parseArgs();

  postX1RewardsToLedger(options)
    .then(() => {
      console.log("🎉 Script finished successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Script failed:", err.message);
      process.exit(1);
    });
}
module.exports = { postX1RewardsToLedger };
