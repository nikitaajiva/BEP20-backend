"use strict";

const mongoose = require("mongoose");
require("dotenv").config();

const LpReward = require("../../models/LpReward");
const AirdropReward = require("../../models/AirdropReward");
const BoostReward = require("../../models/BoostReward");
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const connectDB = require("../../config/db");

// --------------------
// FLAGS
// --------------------
const DRY_RUN = process.argv.includes("--dry-run");

// --------------------
// SAFE HELPERS
// --------------------
const toNum = (v) => parseFloat(v?.toString?.() || 0);
const toDec = (v) =>
  mongoose.Types.Decimal128.fromString(Number(v || 0).toString());

async function creditComputedRewards() {
  await connectDB();
  console.log("✅ MongoDB connected");
  console.log(DRY_RUN ? "🧪 DRY RUN MODE (NO DATA WILL BE CHANGED)" : "🔥 LIVE MODE");

  /* =====================================================
     CURRENT UTC DAY WINDOW (STRICT)
  ===================================================== */
  const now = new Date();

  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
  );

  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    )
  );

  console.log(`📅 Reward Window: ${start.toISOString()} → ${end.toISOString()}`);

  /* =====================================================
     STRICT DATE FILTER (CURRENT DAY ONLY)
  ===================================================== */
  const dateFilter = {
    createdAt: { $gte: start, $lt: end },
    creditProcessed: { $ne: true },
  };

  const pendingLP = await LpReward.find(dateFilter);
  const pendingAir = await AirdropReward.find(dateFilter);
  const pendingBoost = await BoostReward.find(dateFilter);

  console.log(`📦 Pending LP: ${pendingLP.length}`);
  console.log(`📦 Pending Airdrop: ${pendingAir.length}`);
  console.log(`📦 Pending Boost: ${pendingBoost.length}`);

  if (!pendingLP.length && !pendingAir.length && !pendingBoost.length) {
    console.log("⚠️ No pending rewards found.");
    await mongoose.disconnect();
    return;
  }

  let creditedCount = 0;
  let totalAmount = 0;
  const creditRows = [];

  /* =====================================================
     APPLY CREDIT (CAP SAFE + DRY RUN SAFE)
  ===================================================== */
  async function applyCredit(Model, reward, type, limitKey) {
    /* -------------------------
       DRY RUN (READ ONLY)
    ------------------------- */
    if (DRY_RUN) {
      const amount = toNum(reward.amount);
      creditedCount++;
      totalAmount += amount;
      return;
    }

    /* -------------------------
       LIVE MODE — ATOMIC LOCK
    ------------------------- */
    const lockedReward = await Model.findOneAndUpdate(
      { _id: reward._id, creditProcessed: { $ne: true } },
      { $set: { creditProcessed: true } },
      { new: true }
    );

    if (!lockedReward) return;

    const rewardAmount = toNum(lockedReward.amount);
    const ledger = await Ledger.findOne({ userId: lockedReward.userId });
    if (!ledger) return;

    ledger.wallets = ledger.wallets || {};
    ledger.limits = ledger.limits || {};

    /* -------------------------
       FIVE X LIMIT (GLOBAL CAP)
    ------------------------- */
    ledger.limits.fiveXLimit = ledger.limits.fiveXLimit || { used: 0, cap: 0 };

    const fiveXUsed = toNum(ledger.limits.fiveXLimit.used);
    const fiveXCap = toNum(ledger.limits.fiveXLimit.cap);
    const fiveXRemaining = Math.max(0, fiveXCap - fiveXUsed);

    /* -------------------------
       SPECIFIC LIMIT (LP / BOOST / AIRDROP)
    ------------------------- */
    ledger.limits[limitKey] = ledger.limits[limitKey] || { used: 0, cap: 0 };

    const specificUsed = toNum(ledger.limits[limitKey].used);
    const specificCap = toNum(ledger.limits[limitKey].cap);
    const specificRemaining = Math.max(0, specificCap - specificUsed);

    /* -------------------------
       FINAL ALLOWED AMOUNT
    ------------------------- */
    const allowedAmount = Math.min(
      rewardAmount,
      fiveXRemaining,
      specificRemaining
    );

    if (allowedAmount <= 0) {
      console.log(
        `⛔ Cap reached — skipping ${type} for user ${lockedReward.userId}`
      );
      return;
    }

    creditedCount++;
    totalAmount += allowedAmount;

    /* -------------------------
       APPLY WALLET CREDIT
    ------------------------- */
    ledger.wallets.communityRewards = toDec(
      toNum(ledger.wallets.communityRewards) + allowedAmount
    );

    ledger.totalRewardsCredited = toDec(
      toNum(ledger.totalRewardsCredited) + allowedAmount
    );

    /* -------------------------
       UPDATE LIMITS
    ------------------------- */
    ledger.limits.fiveXLimit.used = toDec(fiveXUsed + allowedAmount);
    ledger.limits[limitKey].used = toDec(specificUsed + allowedAmount);

    await ledger.save();

    /* -------------------------
       LEDGER ROW
    ------------------------- */
    creditRows.push({
      userId: lockedReward.userId,
      eventType: type,
      walletTo: "COMMUNITY_REWARDS",
      amount: toDec(allowedAmount),
      narrative:
        allowedAmount < rewardAmount
          ? `${lockedReward.narrative} (Partial due to limit cap)`
          : lockedReward.narrative,
    });
  }

  /* =====================================================
     PROCESS ALL REWARDS
  ===================================================== */
  for (const r of pendingLP) {
    await applyCredit(LpReward, r, "DAILY_REWARDS_LP", "lpLimit");
  }

  for (const r of pendingBoost) {
    await applyCredit(BoostReward, r, "DAILY_REWARDS_BOOST", "boostLimit");
  }

  for (const r of pendingAir) {
    await applyCredit(AirdropReward, r, "DAILY_REWARDS_AIRDROP", "airdropLimit");
  }

  if (!DRY_RUN && creditRows.length > 0) {
    await LedgerRow.insertMany(creditRows, { ordered: false });
  }

  console.log(`
==================== ${DRY_RUN ? "DRY RUN" : "CREDIT"} SUMMARY ====================
💠 LP Rewards:       ${pendingLP.length}
💠 Boost Rewards:    ${pendingBoost.length}
💠 Airdrop Rewards:  ${pendingAir.length}
--------------------------------------------------------
🎉 TOTAL Credits:    ${creditedCount}
💰 TOTAL Amount:     ${totalAmount.toFixed(8)}
========================================================
`);

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected");
}

creditComputedRewards().catch((err) => {
  console.error("❌ Credit job failed:", err);
  process.exit(1);
});
