const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Decimal128 } = require("mongodb");

// --- Models ---
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const BoostReward = require("../../models/BoostReward");
const connectDB = require("../../config/db");

// --- Helpers ---
const toFloat = (decimal) => parseFloat(decimal?.toString() || 0);
const fromFloat = (num) => Decimal128.fromString(Number(num || 0).toFixed(8));

// --- Config ---
const REWARD_THRESHOLD = 5000;
const REWARD_RATE_HIGH = 0.006; // 0.6%
const REWARD_RATE_LOW = 0.005;  // 0.5%
const FIVE_X_MULTIPLIER = 5;

// --- MAIN FUNCTION ---
const giveBoostRewardByUhid = async (uhid, newBoostCap = null, rewardDate = null) => {
  await connectDB();
  

  const ledger = await Ledger.findOne({ uhid });
  if (!ledger) {
    
    process.exit(1);
  }

  try {
    const boostBalance = toFloat(ledger.wallets.boost);
    if (boostBalance <= 0) {
      
      process.exit(0);
    }

    
    

    // --- OPTIONAL: Update Boost Limit Cap ---
    if (newBoostCap !== null) {
      ledger.limits.boostLimit.cap = fromFloat(newBoostCap);
      
    } else if (!ledger.limits.boostLimit.cap || toFloat(ledger.limits.boostLimit.cap) === 0) {
      ledger.limits.boostLimit.cap = fromFloat(boostBalance);
      
    }

    // Determine reward rate
    const boostRate =
      boostBalance >= REWARD_THRESHOLD ? REWARD_RATE_HIGH : REWARD_RATE_LOW;
    let potentialBoostReward = boostBalance * boostRate;

    // Apply boost limit cap
    const capReward = (reward, limit) =>
      Math.max(0, Math.min(reward, toFloat(limit.cap) - toFloat(limit.used)));

    const cappedBoostReward = capReward(
      potentialBoostReward,
      ledger.limits.boostLimit
    );

    if (cappedBoostReward <= 0) {
      
      process.exit(0);
    }

    // Apply global 5x LP limit
    const lpBalance = toFloat(ledger.wallets.lp);
    const fiveXLimitUsed = toFloat(ledger.limits.fiveXLimit.used);
    const maxFiveXBenefit = Math.max(0, lpBalance * FIVE_X_MULTIPLIER - fiveXLimitUsed);
    const finalReward = Math.min(cappedBoostReward, maxFiveXBenefit);

    if (finalReward <= 0) {
      
      process.exit(0);
    }

    // --- Log before balances ---
    

    // Update ledger balances
    ledger.wallets.communityRewards = fromFloat(
      toFloat(ledger.wallets.communityRewards) + finalReward
    );
    ledger.totalRewardsCredited = fromFloat(
      toFloat(ledger.totalRewardsCredited) + finalReward
    );

    ledger.limits.boostLimit.used = fromFloat(
      toFloat(ledger.limits.boostLimit.used) + finalReward
    );
    ledger.limits.fiveXLimit.used = fromFloat(
      toFloat(ledger.limits.fiveXLimit.used) + finalReward
    );

    await ledger.save();

    // --- Log after balances ---
    
    
    

    // --- Custom Date Handling ---
    let ts = new Date(); // default: now
    if (rewardDate) {
      const d = new Date(rewardDate);
      if (!isNaN(d)) {
        ts = d;
        
      } else {
        
      }
    }
    const utcDate = ts.toUTCString();

    // --- Create BoostReward + LedgerRow ---
    const narrative = `Balance: ${boostBalance.toFixed(4)}, Reward: ${finalReward.toFixed(
      4
    )} @ ${(boostRate * 100).toFixed(2)}% on ${utcDate}`;

    await BoostReward.create({
      userId: ledger.userId,
      amount: fromFloat(finalReward),
      rate: fromFloat(boostRate),
      narrative,
      ts, // save custom date
      createdAt: ts,
      updatedAt: ts,
    });

    await LedgerRow.create({
      userId: ledger.userId,
      eventType: "DAILY_REWARDS_BOOST",
      walletTo: "COMMUNITY_REWARDS",
      amount: fromFloat(finalReward),
      narrative: `Daily Boost Reward @ ${(boostRate * 100).toFixed(2)}%`,
      ts, // custom date for history
      createdAt: ts,
      updatedAt: ts,
    });

    
  } catch (error) {
    console.error(`❌ Error processing ${uhid}:`, error);
  } finally {
    await mongoose.disconnect();
    
  }
};

// --- Run with argument ---
// Usage:
// node scripts/rewards/giveBoostRewardByUhid.js <uhid> [newBoostCap] [YYYY-MM-DD]
const args = process.argv.slice(2);
const uhidArg = args[0];
const newBoostCapArg = args[1] ? parseFloat(args[1]) : null;
const rewardDateArg = args[2] || null;

if (!uhidArg) {
  console.error("❗ Usage examples:");
  console.error("   node scripts/rewards/giveBoostRewardByUhid.js 1754734201443");
  console.error("   node scripts/rewards/giveBoostRewardByUhid.js 1754734201443 20000");
  console.error("   node scripts/rewards/giveBoostRewardByUhid.js 1754734201443 20000 2025-10-05");
  console.error("   node scripts/rewards/giveBoostRewardByUhid.js 1754734201443 '' 2025-10-05");
  process.exit(1);
}

giveBoostRewardByUhid(uhidArg, newBoostCapArg, rewardDateArg);
