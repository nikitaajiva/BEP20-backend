/**
 * Script: revokeYesterdayAirdropRewards.js
 * Purpose: Revoke ALL airdrop rewards for yesterday (UTC)
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Decimal128 } = require("mongodb");

const connectDB = require("../../config/db");

// Models
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const AirdropReward = require("../../models/AirdropReward");

// ---------------- HELPERS ----------------
const toFloat = (v) => {
  if (!v) return 0;
  if (v instanceof Decimal128) return parseFloat(v.toString());
  return parseFloat(v);
};

const fromFloat = (v) =>
  Decimal128.fromString(Number(v).toFixed(8));

const clamp = (v) => Math.max(0, v);

// ---------------- DATE (YESTERDAY UTC) ----------------
const START = new Date();
START.setUTCHours(0, 0, 0, 0);
START.setUTCDate(START.getUTCDate() - 1);

const END = new Date();
END.setUTCHours(0, 0, 0, 0);

// ---------------- MAIN ----------------
const revokeYesterdayAirdrops = async () => {
  await connectDB();
  console.log("🚀 Revoking ALL Airdrop rewards (Yesterday UTC)");
  console.log(`🗓 Range: ${START.toISOString()} → ${END.toISOString()}\n`);

  try {
    // 1️⃣ Group total airdrop per user
    const users = await AirdropReward.aggregate([
      {
        $match: {
          createdAt: { $gte: START, $lt: END },
        },
      },
      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    if (!users.length) {
      console.log("✅ No airdrop rewards found for yesterday.");
      return;
    }

    console.log(`⚠ Found ${users.length} users with airdrop rewards\n`);

    for (const u of users) {
      const userId = u._id;
      const revokeAmount = toFloat(u.totalAmount);

      const ledger = await Ledger.findOne({ userId });
      if (!ledger) {
        console.log(`❌ Ledger not found for user ${userId}, skipping`);
        continue;
      }

      console.log(
        `➡ ${ledger.uhid} | Revoking ${u.count} rewards = ${revokeAmount}`
      );

      // ---------------- SAFE LEDGER ROLLBACK ----------------
      const currentCommunity = toFloat(ledger.wallets?.communityRewards);
      const currentTotalRewards = toFloat(ledger.totalRewardsCredited);
      const currentAirdropUsed = toFloat(ledger.limits?.airdropLimit?.used);
      const currentFiveXUsed = toFloat(ledger.limits?.fiveXLimit?.used);
      const currentDailyAirdrop = toFloat(
        ledger.dailyRewards?.dailyRewardsAirdrop
      );

      ledger.wallets.communityRewards = fromFloat(
        clamp(currentCommunity - revokeAmount)
      );

      ledger.totalRewardsCredited = fromFloat(
        clamp(currentTotalRewards - revokeAmount)
      );

      ledger.limits.airdropLimit.used = fromFloat(
        clamp(currentAirdropUsed - revokeAmount)
      );

      ledger.limits.fiveXLimit.used = fromFloat(
        clamp(currentFiveXUsed - revokeAmount)
      );

      ledger.dailyRewards.dailyRewardsAirdrop = fromFloat(
        clamp(currentDailyAirdrop - revokeAmount)
      );

      await ledger.save();

      if (currentCommunity < revokeAmount) {
        console.warn(
          `⚠ communityRewards clamped for ${ledger.uhid} (had ${currentCommunity}, revoke ${revokeAmount})`
        );
      }

      console.log("✔ Ledger reversed safely");

      // ---------------- DELETE REWARD DOCS ----------------
      await AirdropReward.deleteMany({
        userId,
        createdAt: { $gte: START, $lt: END },
      });

      // ---------------- DELETE LEDGER ROWS ----------------
      await LedgerRow.deleteMany({
        userId,
        eventType: "DAILY_REWARDS_AIRDROP",
        ts: { $gte: START, $lt: END },
      });

      console.log("🗑 Rewards + LedgerRows deleted\n");
    }
  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\n🎯 Airdrop revoke completed");
  }
};

revokeYesterdayAirdrops();
