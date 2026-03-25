const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Decimal128 } = require("mongodb");

// Models
const AirdropReward = require("../../models/AirdropReward");
const BoostReward = require("../../models/BoostReward");
const LpReward = require("../../models/LpReward");
const DailyUserLp = require("../../models/DailyUserLp");
const Ledger = require("../../models/Ledger");
const RewardSkipLog = require("../../models/RewardSkipLog");
const connectDB = require("../../config/db");
const ChainDeposit = require("../../models/ChainDeposit");
const ChainWithdrawal = require("../../models/ChainWithdrawal");

// CONFIG
const EXCEPTION_UHIDS = [ /* your UHIDs here */ ];
const REWARD_THRESHOLD = 5000;
const RATE_HIGH = 0.006;
const RATE_LOW = 0.005;
const RATE_PENALTY = 0.003;
const FIVE_X_MULTIPLIER = 5;

// HELPERS
const toFloat = (d) => parseFloat(d?.toString() || "0");
const fixDecimal = (v) => isNaN(parseFloat(v)) ? 0 : parseFloat(v);
const toNumber = (v) => {
  const n = parseFloat(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
};

async function distributeRewards() {
  await connectDB();
  console.log("✅ MongoDB connected");
  console.log("🚀 Starting BULK reward computation (HIGH SPEED)");

  // YESTERDAY UTC
  const today = new Date();
  const rewardDate = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - 1,
    0, 0, 0
  ));

  const safeNumber = (v) => {
  const n = parseFloat(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
};


  console.log(`📅 Processing rewards for: ${rewardDate.toISOString().slice(0, 10)}`);

  // Load all daily LP users
  const dailyRecords = await DailyUserLp.find({ date: rewardDate, lp: { $gt: 8.99 } });
  console.log(`📊 Found ${dailyRecords.length} LP users`);

  if (!dailyRecords.length) return;

  // Load all ledgers
  const userIds = dailyRecords.map(r => r.userId);
  const uhids = dailyRecords.map(r => r.uhid);

  const ledgers = await Ledger.find({
    $or: [
      { userId: { $in: userIds } },
      { uhid: { $in: uhids } },
    ]
  });
const finalUserIds = dailyRecords
  .map(r => r.userId)
  .filter(Boolean);

// ---------------- ON-CHAIN TOTALS ----------------
const depositsAgg = await ChainDeposit.aggregate([
  { $match: { userId: { $in: finalUserIds } } },
  { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
]);

const depositMap = Object.fromEntries(
  depositsAgg.map(d => [d._id.toString(), toNumber(d.total)])
);

const withdrawalsAgg = await ChainWithdrawal.aggregate([
  { $match: { userId: { $in: finalUserIds } } },
  { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
]);

const withdrawalMap = Object.fromEntries(
  withdrawalsAgg.map(w => [w._id.toString(), toNumber(w.total)])
);


  console.log(`📦 Loaded ${ledgers.length} ledgers`);

  const ledgerByUserId = new Map();
  const ledgerByUhid = new Map();
  for (const l of ledgers) {
    if (l.userId) ledgerByUserId.set(l.userId.toString(), l);
    if (l.uhid) ledgerByUhid.set(l.uhid.toString(), l);
  }



  // ----------------------------------------------------
  // BULK FETCH EXISTING REWARDS IN 1 SHOT (NO LOOP FINDS)
  // ----------------------------------------------------
  const existingLP = new Set(
    (await LpReward.find({ ts: rewardDate }).select("userId")).map(a => a.userId.toString())
  );
  const existingAir = new Set(
    (await AirdropReward.find({ ts: rewardDate }).select("userId")).map(a => a.userId.toString())
  );
  const existingBoost = new Set(
    (await BoostReward.find({ ts: rewardDate }).select("userId")).map(a => a.userId.toString())
  );

  console.log("🧮 Existing reward rows fetched");

  // ----------------------------------------------------
  // PREPARE BULK ARRAYS
  // ----------------------------------------------------
  const skipLogs = [];
  const lpDocs = [];
  const airDocs = [];
  const boostDocs = [];

  let processed = 0;
  let skipped = 0;
  let totalReward = 0;

  // ----------------------------------------------------
  // MAIN LOOP (NO DB OPERATIONS INSIDE!)
  // ----------------------------------------------------
  for (const record of dailyRecords) {
    try {
      const uid = record.userId?.toString();
      const uhid = record.uhid?.toString();
      const ledger =
        (uid && ledgerByUserId.get(uid)) ||
        (uhid && ledgerByUhid.get(uhid));

      const lpBalance = record.lp;

      // NO LEDGER FOUND
      if (!ledger) {
        skipLogs.push({
          userId: record.userId,
          username: record.username || "",
          uhid: record.uhid || "",
          rewardDate,
          reason: "NO_LEDGER_FOUND",
          lpBalance
        });
        skipped++;
        continue;
      }

      // ALREADY REWARDED?
      if (existingLP.has(uid) || existingAir.has(uid) || existingBoost.has(uid)) {
        skipLogs.push({
          userId: ledger.userId,
          username: ledger.username,
          uhid: ledger.uhid,
          rewardDate,
          reason: "REWARD_ALREADY_CREATED",
          lpBalance
        });
        skipped++;
        continue;
      }

      const airBalance = toFloat(ledger.wallets?.airdrop);
      const boostBalance = toFloat(ledger.wallets?.boost);

      // Rates
     // const lpRate = lpBalance >= REWARD_THRESHOLD ? RATE_HIGH : RATE_LOW;
     const onChainDeposit = toNumber(depositMap[uid]);
const onChainWithdrawal = toNumber(withdrawalMap[uid]);

let lpRate;

// 🔴 PENALTY CONDITION
if (onChainDeposit < onChainWithdrawal) {
  lpRate = RATE_PENALTY; // 0.003%
} else {
  lpRate = lpBalance >= REWARD_THRESHOLD ? RATE_HIGH : RATE_LOW;
}
if (lpRate === RATE_PENALTY) {
  console.log(
    `⚠️ LP penalty applied | UID=${uid} | Deposit=${onChainDeposit} | Withdrawal=${onChainWithdrawal}`
  );
}

      const airRate = airBalance >= REWARD_THRESHOLD ? RATE_HIGH : RATE_LOW;
      const boostRate = boostBalance >= REWARD_THRESHOLD ? RATE_HIGH : RATE_LOW;
const autoPositioning = safeNumber(ledger.wallets?.autopositionting); // may be 0
let effectiveLpBase = lpBalance - autoPositioning;

// If negative, force base to 10
if (effectiveLpBase < 0) {
  effectiveLpBase = 10;
}

      let lpReward = effectiveLpBase * lpRate;
      let airReward = 0; //airBalance * airRate;
      let boostReward = boostBalance * boostRate;

      // Apply Caps
      const lpCap = fixDecimal(ledger.limits?.lpLimit?.cap || lpBalance * 2);
      const lpUsed = fixDecimal(ledger.limits?.lpLimit?.used);
      lpReward = Math.max(0, Math.min(lpReward, lpCap - lpUsed));

      const airCap = fixDecimal(ledger.limits?.airdropLimit?.cap || airBalance);
      const airUsed = fixDecimal(ledger.limits?.airdropLimit?.used);
      airReward = 0; //Math.max(0, Math.min(airReward, airCap - airUsed));

      const boostCap = fixDecimal(ledger.limits?.boostLimit?.cap || boostBalance);
      const boostUsed = fixDecimal(ledger.limits?.boostLimit?.used);
      boostReward = Math.max(0, Math.min(boostReward, boostCap - boostUsed));

      // UHID block
      let blockedBoost = false;
      if (uhid && EXCEPTION_UHIDS.includes(uhid)) {
        boostReward = 0;
        blockedBoost = true;
      }

      const totalCapReward = lpReward + airReward + boostReward;

      // Apply 5X cap
      const fiveXUsed = fixDecimal(ledger.limits?.fiveXLimit?.used);
      const fiveXMax = lpBalance * FIVE_X_MULTIPLIER - fiveXUsed;

      let finalReward = Math.min(totalCapReward, Math.max(0, fiveXMax));

      // FINAL REWARD ZERO → skip + log
      if (finalReward <= 0) {
        skipLogs.push({
          userId: ledger.userId,
          username: ledger.username,
          uhid: ledger.uhid,
          rewardDate,
          reason: "REWARD_ZERO_AFTER_CAP",
          lpBalance,
          airdropBalance: airBalance,
          boostBalance
        });
        skipped++;
        continue;
      }

      // Proportional adjustment if capped
      const factor = finalReward / totalCapReward;
      if (factor < 1) {
        lpReward *= factor;
        airReward *= factor;
        if (!blockedBoost) boostReward *= factor;
      }

      totalReward += finalReward;

      // Build reward docs
      const ts = rewardDate;

      if (lpReward > 0)
        lpDocs.push({
          userId: ledger.userId,
          amount: Decimal128.fromString(lpReward.toString()),
          rate: Decimal128.fromString(lpRate.toString()),
          narrative: `LP Reward ${lpReward.toFixed(4)} @ ${(lpRate * 100).toFixed(2)}%`,
          ts,
          creditProcessed: false
        });

      if (airReward > 0)
        airDocs.push({
          userId: ledger.userId,
          amount: Decimal128.fromString(airReward.toString()),
          rate: Decimal128.fromString(airRate.toString()),
          narrative: `Airdrop Reward ${airReward.toFixed(4)} @ ${(airRate * 100).toFixed(2)}%`,
          ts,
          creditProcessed: false
        });

      if (boostReward > 0)
        boostDocs.push({
          userId: ledger.userId,
          amount: Decimal128.fromString(boostReward.toString()),
          rate: Decimal128.fromString(boostRate.toString()),
          narrative: `Boost Reward ${boostReward.toFixed(4)} @ ${(boostRate * 100).toFixed(2)}%`,
          ts,
          creditProcessed: false
        });

      processed++;

    } catch (err) {
      console.error("❌ Loop error:", err);
      skipped++;
    }
  }

  // ----------------------------------------------------
  // BULK INSERT EVERYTHING AT END (SUPER FAST)
  // ----------------------------------------------------

  if (skipLogs.length)
    await RewardSkipLog.insertMany(skipLogs, { ordered: false });

  if (lpDocs.length)
    await LpReward.insertMany(lpDocs, { ordered: false });

  if (airDocs.length)
    await AirdropReward.insertMany(airDocs, { ordered: false });

  if (boostDocs.length)
    await BoostReward.insertMany(boostDocs, { ordered: false });

  console.log(`
==================== SUMMARY ====================
👤 Processed Users: ${processed}
⚠️ Skipped Users:   ${skipped}
💰 Total Reward:    ${totalReward.toFixed(8)}
📝 Skip Logs:       ${skipLogs.length}
🧾 LP Rewards:      ${lpDocs.length}
🧾 Airdrop Rewards: ${airDocs.length}
🧾 Boost Rewards:   ${boostDocs.length}
=================================================
  `);

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected.");
}

distributeRewards();
