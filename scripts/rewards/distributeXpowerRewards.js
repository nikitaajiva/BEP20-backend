"use strict";

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../../config/db");

const X1Reward = require("../../models/X1Reward");
const XPowerReward = require("../../models/XPowerReward");
const LedgerRow = require("../../models/LedgerRow");
const User = require("../../models/User");
const Ledger = require("../../models/Ledger");

/* =========================
   HELPERS
========================= */
function getTodayRangeUTC() {
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23, 59, 59, 999
  ));
  return { start, end };
}

function d128ToNumber(v) {
  return parseFloat(v?.toString?.() || "0");
}

/* =========================
   STEP 1: DISTRIBUTE XPOWER
   (PER-USER SAFE)
========================= */
async function distributeXPowerRewards() {
  const { start, end } = getTodayRangeUTC();

  const aggregated = await X1Reward.aggregate([
    { $match: { ts: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: "$userId",
        totalAmount: { $sum: { $toDouble: "$amount" } },
        sourceRewardIds: { $addToSet: "$_id" },
      },
    },
  ]);

  

  for (const entry of aggregated) {
    try {
      const downlineUserId = entry._id;
      const totalAmount = Number(entry.totalAmount || 0);
      if (totalAmount <= 0) continue;

      const downlineUser = await User.findById(downlineUserId).select("username xRank");
      if (!downlineUser || !downlineUser.xRank) {
        console.warn(`⚠️ Skipped downline (missing xRank) → ${downlineUserId}`);
        continue;
      }

      const tier = downlineUser.xRank;
      let currentUserId = downlineUserId;
      let eligibleCount = 0;

      while (eligibleCount < 3) {
        const u = await User.findById(currentUserId).select("sponsorId");
        if (!u || !u.sponsorId) break;

        const sponsor = await User.findById(u.sponsorId).select("xRank username");
        currentUserId = u.sponsorId;

        if (!sponsor || !sponsor.xRank) {
          console.warn(`⚠️ Skipped sponsor (missing xRank) → ${u.sponsorId}`);
          continue;
        }

        if (sponsor.xRank === tier) {
          const rewardAmount = Number((totalAmount * 0.07).toFixed(6));

          const exists = await XPowerReward.findOne({
            userId: sponsor._id,
            fromUserId: downlineUserId,
            tier,
            level: eligibleCount + 1,
            ts: { $gte: start, $lte: end },
          });

          if (!exists) {
            await XPowerReward.create({
              userId: sponsor._id,
              fromUserId: downlineUserId,
              xRank: sponsor.xRank,
              tier,
              amount: rewardAmount.toFixed(6),
              level: eligibleCount + 1,
              sourceRewardId: entry.sourceRewardIds[0],
              ts: new Date(),
            });

            console.log(
              `✅ XPowerReward → ${sponsor.username || sponsor._id} +${rewardAmount.toFixed(6)}`
            );
          }

          eligibleCount++;
        }
      }
    } catch (err) {
      console.error(
        `❌ XPowerReward failed for downline ${entry._id} → ${err.message}`
      );
      continue; // 🔥 DO NOT HALT
    }
  }
}

/* =========================
   STEP 2: LEDGER CREDIT
   (DAILY + PER-USER SAFE)
========================= */
async function createLedgerRowsFromXPower() {
  const { start, end } = getTodayRangeUTC();

  const aggregated = await XPowerReward.aggregate([
    { $match: { ts: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: "$userId",
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  

  for (const entry of aggregated) {
    try {
      const userId = entry._id;
      const rawAmount = Number(entry.totalAmount || 0);
      if (rawAmount <= 0) continue;

      /* 🔒 DAILY IDEMPOTENCY CHECK */
      const alreadyCredited = await LedgerRow.findOne({
        userId,
        eventType: "XPOWER_REWARDS",
        createdAt: { $gte: start, $lte: end },
      }).lean();

      if (alreadyCredited) {
        
        continue;
      }

      const ledger = await Ledger.findOne(
        { userId },
        {
          "wallets.communityRewards": 1,
          totalRewardsCredited: 1,
          "limits.fiveXLimit.cap": 1,
          "limits.fiveXLimit.used": 1,
        }
      );

      if (!ledger) {
        console.warn(`⚠️ Ledger missing → ${userId}`);
        continue;
      }

      const cap = d128ToNumber(ledger.limits?.fiveXLimit?.cap);
      const used = d128ToNumber(ledger.limits?.fiveXLimit?.used);

      const remaining = cap > 0 ? cap - used : rawAmount;
      if (cap > 0 && remaining <= 0) continue;

      const credit = cap > 0 ? Math.min(rawAmount, remaining) : rawAmount;
      if (credit <= 0) continue;

      const creditStr = credit.toFixed(6);

      await LedgerRow.create({
        userId,
        eventType: "XPOWER_REWARDS",
        walletFrom: "SYSTEM",
        walletTo: "COMMUNITY_REWARDS",
        amount: mongoose.Types.Decimal128.fromString(creditStr),
        narrative: "Daily X Power bonus",
        cascadeProcessed: true,
        positioningBonusProcessed: false,
        communityBoosterProcessed: true,
        status: "INITIATED",
      });

      ledger.wallets.communityRewards = mongoose.Types.Decimal128.fromString(
        (d128ToNumber(ledger.wallets.communityRewards) + credit).toFixed(6)
      );

      ledger.totalRewardsCredited = mongoose.Types.Decimal128.fromString(
        (d128ToNumber(ledger.totalRewardsCredited) + credit).toFixed(6)
      );

      if (cap > 0) {
        ledger.limits.fiveXLimit.used = mongoose.Types.Decimal128.fromString(
          (used + credit).toFixed(6)
        );
      }

      await ledger.save();

      
    } catch (err) {
      console.error(
        `❌ Ledger credit failed for user ${entry._id} → ${err.message}`
      );
      continue; // 🔥 DO NOT HALT
    }
  }
}

/* =========================
   RUNNER
========================= */
async function main() {
  try {
    await connectDB();
    await distributeXPowerRewards();
    await createLedgerRowsFromXPower();
    
    process.exit(0);
  } catch (err) {
    console.error("❌ XPower process failed:", err);
    process.exit(1);
  }
}

main();
