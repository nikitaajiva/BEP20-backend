const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Types;
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Import models
const User = require("../../models/User");
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const Level = require("../../models/Level");
const DailyRewardLog = require('../../models/DailyRewardLog');
const CascadeReward = require("../../models/CascadeReward");
const {
  getOrCreateLedger,
} = require("../../jobs/helpers/ledgerHelpers");
const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  compareDecimal128,
} = require("../../utils/decimal128Utils");
const { SponsorUnlockAtLevel } = require('../../jobs/eventHandlers/differentialRoiCascadeHandler');

const connectDB = require("../../config/db");
function getYesterdayUtcRange() {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const yesterdayUTC = new Date(todayUTC);
  yesterdayUTC.setUTCDate(todayUTC.getUTCDate() - 1);

  const endOfYesterdayUTC = new Date(todayUTC.getTime() - 1);

  return {
    from: yesterdayUTC,
    to: endOfYesterdayUTC,
  };
}

// cascade rules (SAME AS BEFORE)
const rules = [
  { level: 1, pct: 0.12, minDirects: 1, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 2, pct: 0.1, minDirects: 2, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 3, pct: 0.07, minDirects: 3, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 4, pct: 0.05, minDirects: 4, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 5, pct: 0.05, minDirects: 5, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 6, pct: 0.05, minDirects: 5, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 7, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 8, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 9, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 10, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 11, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 12, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 13, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 14, pct: 0.07, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
  { level: 15, pct: 0.1, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
  { level: 16, pct: 0.12, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
];

// -------- helper: get “yesterday 23:58:00” UTC ----------
function getYesterdayUtcDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(23, 58, 0, 0); // yesterday 23:58:00
  return d;
}

// -------- archive & reset (same as before) --------
const archiveAndResetDailyRewards = async () => {
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // Use UTC date for consistency

  // Find all ledgers where dailyCascadeRewards > 0
  const ledgersToArchive = await Ledger.find({ 'wallets.dailyCascadeRewards': { $gt: Decimal128.fromString('0') } });

  if (ledgersToArchive.length === 0) {
    
    return;
  }

  const archiveOps = [];
  const resetOps = [];

  for (const ledger of ledgersToArchive) {
    // 1. Prepare archive operation
    archiveOps.push({
      insertOne: {
        document: {
          userId: ledger.userId,
          date: today,
          rewardType: 'cascade',
          amount: ledger.wallets.dailyCascadeRewards
        }
      }
    });

    // 2. Prepare reset operation
    resetOps.push({
      updateOne: {
        filter: { _id: ledger._id },
        update: { $set: { 'wallets.dailyCascadeRewards': Decimal128.fromString('0') } }
      }
    });
  }

  // Execute bulk operations
  await DailyRewardLog.bulkWrite(archiveOps);
  await Ledger.bulkWrite(resetOps);

  
};


// -------- sponsor stats (same as before) --------
async function getSponsorStats() {
  const agg = await Level.aggregate([
    { $match: { level: { $lte: 5 } } },
    {
      $lookup: { from: "users", localField: "child", foreignField: "uhid", as: "childUser" },
    },
    { $unwind: "$childUser" },
    {
      $lookup: { from: "ledgers", localField: "childUser._id", foreignField: "userId", as: "childLedger" },
    },
    { $unwind: { path: "$childLedger", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        parent: 1,
        level: 1,
        childLp: { $toDouble: { $ifNull: ["$childLedger.wallets.lp", 0] } },
      },
    },
    {
      $group: {
        _id: { parent: "$parent", level: "$level" },
        totalLp: { $sum: "$childLp" },
        activeDirectsAtLevel: { $sum: { $cond: [{ $gte: ["$childLp", 9] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: "$_id.parent",
        perLevel: { $push: { level: "$_id.level", totalLp: "$totalLp", activeDirectsAtLevel: "$activeDirectsAtLevel" } },
      },
    },
    {
      $project: {
        teamLp3Sum: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $lte: ["$$lvl.level", 3] }, "$$lvl.totalLp", 0] },
            },
          },
        },
        teamLp5Sum: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $lte: ["$$lvl.level", 5] }, "$$lvl.totalLp", 0] },
            },
          },
        },
        activeDirectsCount: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $eq: ["$$lvl.level", 1] }, "$$lvl.activeDirectsAtLevel", 0] },
            },
          },
        },
      },
    },
  ]);

  const statsMap = new Map();
  for (const doc of agg) {
    statsMap.set(doc._id, {
      activeDirectsCount: doc.activeDirectsCount || 0,
      teamLp3Sum: doc.teamLp3Sum || 0,
      teamLp5Sum: doc.teamLp5Sum || 0,
    });
  }

  const uhids = Array.from(statsMap.keys());
  const users = await User.find({ uhid: { $in: uhids } }).select("_id uhid username").lean();
  const userByUhid = new Map(users.map((u) => [u.uhid, u]));
  const userIds = users.map((u) => u._id);

  const ledgers = await Ledger.find({ userId: { $in: userIds } }).select("userId wallets.lp").lean();
  const ledgerById = new Map(ledgers.map((l) => [String(l.userId), l]));
  const idByUhid = new Map(users.map((u) => [u.uhid, String(u._id)]));

  for (const [uhid, stats] of statsMap.entries()) {
    const uid = idByUhid.get(uhid);
    const ledger = ledgerById.get(uid);
    const selfLp = ledger?.wallets?.lp ? Number(ledger.wallets.lp.toString()) : 0;
    statsMap.set(uhid, { ...stats, selfLp });
  }

  return { statsMap, userByUhid };
}


// -------- REAL RUN (same logic, just sets createdAt/updatedAt to yesterday 23:58) --------
async function distributeDifferentialCascadeRewards() {
  await connectDB();
  

  await archiveAndResetDailyRewards();

  const cascadeTs = getYesterdayUtcDate();

  // Precompute unlocks
  const { statsMap, userByUhid } = await getSponsorStats();
  const highestLevelMap = new Map();
  for (const [uhid, stats] of statsMap.entries()) {
    let highest = 0;
    for (const rule of rules) {
      const res = await SponsorUnlockAtLevel({ uhid }, rule, stats);
      if (res.qualified) highest = rule.level;
      else break;
    }
    highestLevelMap.set(uhid, highest);
  }

  const users = await User.find().select("_id uhid username").lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const uplinesRaw = await Level.find({ level: { $lte: 64 } })
    .select("child parent level")
    .sort({ level: 1 })
    .lean();
  const uplinesByChildUhid = new Map();
  for (const row of uplinesRaw) {
    if (!uplinesByChildUhid.has(row.child)) uplinesByChildUhid.set(row.child, []);
    uplinesByChildUhid.get(row.child).push({ level: row.level, parent: row.parent });
  }

  // Load events
const { from, to } = getYesterdayUtcRange();

const lpDepositEvents = await LedgerRow.find({
  eventType: "DAILY_REWARDS_LP",
  cascadeProcessed: { $ne: true },
  ts: {
    $gte: from,
    $lte: to,
  },
}).lean();

console.log(
  `DRY RUN window (UTC): ${from.toISOString()} → ${to.toISOString()}`
)

  

  const payouts = [];
  const processedIds = [];

const totalEvents = lpDepositEvents.length;
let processed = 0;
const startedAt = Date.now();

for (const event of lpDepositEvents) {
  processed++;
  
  // ---- PROGRESS DISPLAY EVERY 100 entries ----
  if (processed % 100 === 0 || processed === totalEvents) {
    const percent = ((processed / totalEvents) * 100).toFixed(2);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const eta = processed > 0 
      ? (((Date.now() - startedAt) / processed) * (totalEvents - processed) / 1000).toFixed(1)
      : "0";

    console.log(
      `Progress: ${processed} / ${totalEvents} (${percent}%) | Elapsed: ${elapsed}s | ETA: ${eta}s`
    );
  }
  // --------------------------------------------

  const depositor = userById.get(String(event.userId));
  if (!depositor) continue;

  const uplines = uplinesByChildUhid.get(depositor.uhid) || [];
  const depositAmountD128 = Decimal128.fromString(String(event.amount));

  for (let lvl = 1; lvl <= 16; lvl++) {
    const rule = rules.find(r => r.level === lvl);
    let sponsorRecord = uplines.find(u => u.level === lvl);
    let paid = false;

    while (sponsorRecord) {
      const sponsor = userByUhid.get(sponsorRecord.parent);
      if (!sponsor) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      const sponsorUnlock = highestLevelMap.get(sponsor.uhid) || 0;
      if (sponsorUnlock < lvl) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      const rateD128 = Decimal128.fromString(String(rule.pct));
      let payout = multiplyDecimal128(depositAmountD128, rateD128);
      if (Number(payout.toString()) <= 0) break;

      const sLedger = await getOrCreateLedger(sponsor._id);

      const remaining5x = subtractDecimal128(
        sLedger.limits.fiveXLimit.cap,
        sLedger.limits.fiveXLimit.used
      );

      if (Number(remaining5x.toString()) <= 0) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      if (compareDecimal128(payout, remaining5x) === 1) payout = remaining5x;
      if (Number(payout.toString()) <= 0) break;

      // Ledger credit
      sLedger.wallets.cascadeRewards = addDecimal128(sLedger.wallets.cascadeRewards, payout);
      sLedger.wallets.communityRewards = addDecimal128(sLedger.wallets.communityRewards, payout);
      sLedger.wallets.dailyCascadeRewards = addDecimal128(sLedger.wallets.dailyCascadeRewards, payout);
      sLedger.limits.fiveXLimit.used = addDecimal128(sLedger.limits.fiveXLimit.used, payout);
      await sLedger.save();

      payouts.push({
        userId: sponsor._id,
        triggeringUserId: event.userId,
        triggeringEventId: event._id,
        amount: payout,
        rate: rateD128,
        narrative: `Differential Cascade (L${lvl} @ ${rule.pct * 100}%) from ${depositor.username}.`,
        createdAt: cascadeTs,
        updatedAt: cascadeTs,
      });

      paid = true;
      break;
    }
  }

  processedIds.push(event._id);
}

  // Bulk write
  if (payouts.length) await CascadeReward.insertMany(payouts);
  if (processedIds.length) {
    await LedgerRow.updateMany(
      { _id: { $in: processedIds } },
      { $set: { cascadeProcessed: true } }
    );
  }

  

  await mongoose.disconnect();
}


// -------- DRY RUN: no writes, only simulate & time --------
async function distributeDifferentialCascadeRewardsDryRun() {
  await connectDB();
  

  const start = Date.now();

  // Precompute unlocks (same as real)
  const { statsMap, userByUhid } = await getSponsorStats();
  const highestLevelMap = new Map();
  for (const [uhid, stats] of statsMap.entries()) {
    let highest = 0;
    for (const rule of rules) {
      const res = await SponsorUnlockAtLevel({ uhid }, rule, stats);
      if (res.qualified) highest = rule.level;
      else break;
    }
    highestLevelMap.set(uhid, highest);
  }

  const users = await User.find().select("_id uhid username").lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const uplinesRaw = await Level.find({ level: { $lte: 64 } })
    .select("child parent level")
    .sort({ level: 1 })
    .lean();
  const uplinesByChildUhid = new Map();
  for (const row of uplinesRaw) {
    if (!uplinesByChildUhid.has(row.child)) uplinesByChildUhid.set(row.child, []);
    uplinesByChildUhid.get(row.child).push({ level: row.level, parent: row.parent });
  }

  // For dry run, we read sponsor ledgers once (no saves)
  const sponsorUsers = Array.from(userByUhid.values());
  const sponsorUserIds = sponsorUsers.map(u => u._id);
  const sponsorLedgers = await Ledger.find({ userId: { $in: sponsorUserIds } }).lean();
  const ledgerByUserId = new Map(sponsorLedgers.map(l => [String(l.userId), l]));

  // Load events
  const lpDepositEvents = await LedgerRow.find({
    eventType: "DAILY_REWARDS_LP",
    cascadeProcessed: { $ne: true },
  }).lean();

  

  let payoutCount = 0;
  let totalPayoutAmount = 0;

  for (const event of lpDepositEvents) {
    const depositor = userById.get(String(event.userId));
    if (!depositor) continue;

    const uplines = uplinesByChildUhid.get(depositor.uhid) || [];
    const depositAmountD128 = Decimal128.fromString(String(event.amount));

    for (let lvl = 1; lvl <= 16; lvl++) {
      const rule = rules.find((r) => r.level === lvl);
      let sponsorRecord = uplines.find((u) => u.level === lvl);
      let paid = false;

      while (sponsorRecord) {
        const sponsor = userByUhid.get(sponsorRecord.parent);
        if (!sponsor) {
          sponsorRecord = uplines.find((u) => u.level === sponsorRecord.level + 1);
          continue;
        }

        const sponsorUnlock = highestLevelMap.get(sponsor.uhid) || 0;
        if (sponsorUnlock < lvl) {
          sponsorRecord = uplines.find((u) => u.level === sponsorRecord.level + 1);
          continue;
        }

        const sponsorIdStr = String(sponsor._id);
        const sLedger = ledgerByUserId.get(sponsorIdStr);
        if (!sLedger) {
          sponsorRecord = uplines.find((u) => u.level === sponsorRecord.level + 1);
          continue;
        }

        const rateD128 = Decimal128.fromString(String(rule.pct));
        let payout = multiplyDecimal128(depositAmountD128, rateD128);
        if (Number(payout.toString()) <= 0) break;

        const cap = sLedger.limits?.fiveXLimit?.cap || Decimal128.fromString("0");
        const used = sLedger.limits?.fiveXLimit?.used || Decimal128.fromString("0");
        const remaining5x = subtractDecimal128(cap, used);
        if (Number(remaining5x.toString()) <= 0) {
          sponsorRecord = uplines.find((u) => u.level === sponsorRecord.level + 1);
          continue;
        }
        if (compareDecimal128(payout, remaining5x) === 1) payout = remaining5x;
        if (Number(payout.toString()) <= 0) break;

        // Simulate updating used in-memory only
        sLedger.limits.fiveXLimit.used = addDecimal128(used, payout);

        payoutCount += 1;
        totalPayoutAmount += Number(payout.toString());

        paid = true;
        break;
      }
    }
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(2);
  
  
  
  
  
  
  

  await mongoose.disconnect();
}


// --------- (Optional) your existing debug function, unchanged ----------
async function distributeDifferentialCascadeRewardsDebug() {
  await connectDB();
  

  await archiveAndResetDailyRewards();

  // Precompute unlocks
  const { statsMap, userByUhid: statsUserByUhid } = await getSponsorStats();
  const highestLevelMap = new Map();
  for (const [uhid, stats] of statsMap.entries()) {
    let highest = 0;
    for (const rule of rules) {
      const res = await SponsorUnlockAtLevel({ uhid }, rule, stats);
      if (res.qualified) highest = rule.level;
      else break;
    }
    highestLevelMap.set(uhid, highest);
  }

  // Build uplines map
  const uplinesRaw = await Level.find({ level: { $lte: 64 } })
    .select("child parent level")
    .sort({ level: 1 })
    .lean();

  const uplinesByChildUhid = new Map();
  const allParentUhids = new Set();
  for (const row of uplinesRaw) {
    if (!uplinesByChildUhid.has(row.child)) uplinesByChildUhid.set(row.child, []);
    uplinesByChildUhid.get(row.child).push({ level: row.level, parent: row.parent });
    allParentUhids.add(row.parent);
  }

  const parentsUsers = await User.find({ uhid: { $in: Array.from(allParentUhids) } })
    .select("_id uhid username")
    .lean();
  const userByUhidAll = new Map(parentsUsers.map(u => [u.uhid, u]));

  const allUsers = await User.find().select("_id uhid username").lean();
  const userById = new Map(allUsers.map(u => [String(u._id), u]));

  // Load only 10 events for debug
  const lpDepositEvents = await LedgerRow.find({
    eventType: "DAILY_REWARDS_LP",
    cascadeProcessed: { $ne: true },
  }).limit(10).lean();

  
const totalEvents = lpDepositEvents.length;
let processed = 0;
const startedAt = Date.now();

for (const event of lpDepositEvents) {
  processed++;
  
  // ---- PROGRESS DISPLAY EVERY 100 entries ----
  if (processed % 100 === 0 || processed === totalEvents) {
    const percent = ((processed / totalEvents) * 100).toFixed(2);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const eta = processed > 0 
      ? (((Date.now() - startedAt) / processed) * (totalEvents - processed) / 1000).toFixed(1)
      : "0";

    console.log(
      `Progress: ${processed} / ${totalEvents} (${percent}%) | Elapsed: ${elapsed}s | ETA: ${eta}s`
    );
  }
  // --------------------------------------------

  const depositor = userById.get(String(event.userId));
  if (!depositor) continue;

  const uplines = uplinesByChildUhid.get(depositor.uhid) || [];
  const depositAmountD128 = Decimal128.fromString(String(event.amount));

  for (let lvl = 1; lvl <= 16; lvl++) {
    const rule = rules.find(r => r.level === lvl);
    let sponsorRecord = uplines.find(u => u.level === lvl);
    let paid = false;

    while (sponsorRecord) {
      const sponsor = userByUhid.get(sponsorRecord.parent);
      if (!sponsor) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      const sponsorUnlock = highestLevelMap.get(sponsor.uhid) || 0;
      if (sponsorUnlock < lvl) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      const rateD128 = Decimal128.fromString(String(rule.pct));
      let payout = multiplyDecimal128(depositAmountD128, rateD128);
      if (Number(payout.toString()) <= 0) break;

      const sLedger = await getOrCreateLedger(sponsor._id);

      const remaining5x = subtractDecimal128(
        sLedger.limits.fiveXLimit.cap,
        sLedger.limits.fiveXLimit.used
      );

      if (Number(remaining5x.toString()) <= 0) {
        sponsorRecord = uplines.find(u => u.level === sponsorRecord.level + 1);
        continue;
      }

      if (compareDecimal128(payout, remaining5x) === 1) payout = remaining5x;
      if (Number(payout.toString()) <= 0) break;

      // Ledger credit
      sLedger.wallets.cascadeRewards = addDecimal128(sLedger.wallets.cascadeRewards, payout);
      sLedger.wallets.communityRewards = addDecimal128(sLedger.wallets.communityRewards, payout);
      sLedger.wallets.dailyCascadeRewards = addDecimal128(sLedger.wallets.dailyCascadeRewards, payout);
      sLedger.limits.fiveXLimit.used = addDecimal128(sLedger.limits.fiveXLimit.used, payout);
      await sLedger.save();

      payouts.push({
        userId: sponsor._id,
        triggeringUserId: event.userId,
        triggeringEventId: event._id,
        amount: payout,
        rate: rateD128,
        narrative: `Differential Cascade (L${lvl} @ ${rule.pct * 100}%) from ${depositor.username}.`,
        createdAt: cascadeTs,
        updatedAt: cascadeTs,
      });

      paid = true;
      break;
    }
  }

  processedIds.push(event._id);
}

  await mongoose.disconnect();
}


// -------- ENTRYPOINT --------
const MODE = process.argv[2] || "run";

if (MODE === "dry") {
  distributeDifferentialCascadeRewardsDryRun();
} else if (MODE === "debug") {
  distributeDifferentialCascadeRewardsDebug();
} else {
  distributeDifferentialCascadeRewards();
}
