/**
 * Script: findMissingDailyLpLedgerRows.js
 *
 * Purpose:
 *  - Find LP rewards (lprewards collection)
 *  - For date: 2025-12-12
 *  - Which DO NOT have a LedgerRow with:
 *      eventType = DAILY_LP_REWARDS
 *      matching userId
 *      matching amount
 *      matching ts (NOT createdAt)
 *
 * Usage:
 *   node scripts/findMissingDailyLpLedgerRows.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const LpReward = require("../models/LpReward");
const LedgerRow = require("../models/LedgerRow");
const User = require("../models/User");

const TARGET_DATE = "2025-12-12";
const EVENT_TYPE = "DAILY_LP_REWARDS";

// ----------------------------------------------------
// UTC Date Range
// ----------------------------------------------------
function getUtcDateRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);
  return { start, end };
}

async function run() {
  try {
    await connectDB();
    

    const { start, end } = getUtcDateRange(TARGET_DATE);

    // ---------------------------------------
    // Fetch LP rewards for date
    // ---------------------------------------
    const lpRewards = await LpReward.find({
      createdAt: { $gte: start, $lte: end }
    }).lean();

    

    if (!lpRewards.length) {
      
      return;
    }

    const missing = [];

    // ---------------------------------------
    // Check missing LedgerRows (using ts)
    // ---------------------------------------
    for (const reward of lpRewards) {
      const exists = await LedgerRow.findOne({
        userId: reward.userId,
        eventType: EVENT_TYPE,
        amount: reward.amount,
        ts: { $gte: start, $lte: end }   // ✅ IMPORTANT CHANGE
      }).lean();

      if (!exists) {
        const user = await User.findById(reward.userId)
          .select("username uhid")
          .lean();

        missing.push({
          userId: reward.userId,
          username: user?.username || "",
          uhid: user?.uhid || "",
          amount: reward.amount,
          narrative: reward.narrative,
          rewardCreatedAt: reward.createdAt
        });
      }
    }

    // ---------------------------------------
    // Output
    // ---------------------------------------
    

    if (!missing.length) {
      
    } else {
      

      missing.forEach((m, i) => {
        console.log(
          `${i + 1}. Username: ${m.username} | UHID: ${m.uhid} | Amount: ${m.amount}`
        );
      });
    }

  } catch (err) {
    console.error("❌ Script error:", err);
  } finally {
    await mongoose.disconnect();
    
    process.exit(0);
  }
}

run();
