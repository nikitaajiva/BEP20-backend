const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const CommunityBoosterReward = require('../../models/CommunityBoosterReward');
const { Decimal128 } = mongoose.Types;

const connectDB = require("../../config/db");

const LOG_FILE = path.join(__dirname, '../../logs/Community_Booster_Rewards.log');


// Handle optional CLI date arg
const argDate = process.argv[2]; // e.g., "2025-08-04"
const rewardDate = argDate ? new Date(argDate) : new Date(Date.now() - 86400000);
const dateStr = rewardDate.toISOString().substring(0, 10);

// Build start/end of day (UTC-safe)
const start = new Date(rewardDate);
start.setUTCHours(0, 0, 0, 0);

const end = new Date(rewardDate);
end.setUTCHours(23, 59, 59, 999);

const logToFile = (line) => {
  fs.appendFileSync(LOG_FILE, `${line}\n`);
};

const updateCommunityRewards = async () => {
  console.log(`📅 Processing Community Booster Rewards for: ${dateStr}`);
  logToFile(`\n📅 Log for Community Booster Rewards on ${dateStr}`);

  const rewards = await CommunityBoosterReward.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: '$userId',
        totalAmount: { $sum: '$amount' },
      },
    },
  ]);

  console.log(`🔍 Found ${rewards.length} users with community booster rewards.`);

  for (const reward of rewards) {
    const userId = reward._id;
    const amount = Decimal128.fromString(reward.totalAmount.toString());

    const ledger = await Ledger.findOne({ userId });

    if (!ledger) {
      console.warn(`⚠️ Ledger not found for userId: ${userId}`);
      continue;
    }

    /* =====================================================
       🚫 5× CAP CHECK (CRITICAL)
    ===================================================== */
    const fiveXCap = parseFloat(ledger.limits?.fiveXLimit?.cap || 0);
    const fiveXUsed = parseFloat(ledger.limits?.fiveXLimit?.used || 0);

    if (fiveXCap > 0 && fiveXUsed >= fiveXCap) {
      const msg = `🚫 SKIPPED (5× cap reached) userId=${userId}, used=${fiveXUsed}, cap=${fiveXCap}`;
      console.log(msg);
      logToFile(msg);
      continue;
    }

    /* =====================================================
       💰 CREDIT COMMUNITY REWARDS WALLET
    ===================================================== */
    const oldBalance = ledger.wallets?.communityRewards || Decimal128.fromString("0.0");

    const updatedBalance = Decimal128.fromString(
      (
        parseFloat(oldBalance.toString()) +
        parseFloat(amount.toString())
      ).toFixed(6)
    );

    ledger.wallets.communityRewards = updatedBalance;

    // ⚠️ Optional: if community booster should also increase 5× used
    // Uncomment ONLY if business rule allows it
    /*
    ledger.limits.fiveXLimit.used = Decimal128.fromString(
      (fiveXUsed + parseFloat(amount.toString())).toFixed(6)
    );
    */

    await ledger.save();

    /* =====================================================
       🧾 LEDGER ROW
    ===================================================== */
    const ts = new Date(rewardDate);
    ts.setUTCDate(ts.getUTCDate() + 1); // same logic as your original

    const row = new LedgerRow({
      userId,
      eventType: 'DAILY_REWARDS_COMMUNITY_BOOSTER',
      walletFrom: 'COMMUNITY_BOOSTER',
      walletTo: 'COMMUNITY_REWARDS',
      amount,
      narrative: 'Daily Community Booster Reward (aggregated)',
      status: 'COMPLETED',
      ts,
    });

    await row.save();

    const uhid = ledger.uhid || 'N/A';
    const logLine = `✅ userId=${userId}, uhid=${uhid}, credited=${amount.toString()}, oldBalance=${oldBalance.toString()}`;
    console.log(logLine);
    logToFile(logLine);
  }
};

const run = async () => {
  await connectDB();
  await updateCommunityRewards();
  mongoose.connection.close();
};

run();
