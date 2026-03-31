const mongoose = require("mongoose");
require("dotenv").config();

const LpReward = require("../../models/LpReward");
const AirdropReward = require("../../models/AirdropReward");
const BoostReward = require("../../models/BoostReward");
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const connectDB = require("../../config/db");

async function creditComputedRewards() {
  await connectDB();
  

  const now = new Date();

  // yesterday UTC window
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() , 0, 0, 0));
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

  

  // ---------------------------------------------
  // SUPPORT BOTH `ts` AND `createdAt` !!!
  // ---------------------------------------------
  const dateFilter = {
    $or: [
      { ts: { $gte: start, $lt: end } },         // Preferred — new rewards
      { createdAt: { $gte: start, $lt: end } }   // Fallback — old rewards
    ],
    creditProcessed: { $ne: true }
  };

  // Fetch all pending rewards together
  const pendingLP     = await LpReward.find(dateFilter);
  const pendingAir    = await AirdropReward.find(dateFilter);
  const pendingBoost  = await BoostReward.find(dateFilter);

  const totalPending = pendingLP.length + pendingAir.length + pendingBoost.length;

  
  
  
  

  if (totalPending === 0) {
    
    await mongoose.disconnect();
    return;
  }

  let creditedCount = 0;

  // Helper to credit rows
  const creditRows = [];

  async function applyCredit(reward, type) {
    const ledger = await Ledger.findOne({ userId: reward.userId });
    if (!ledger) return;

    const amount = parseFloat(reward.amount.toString());

    // Update ledger
    ledger.wallets.communityRewards = mongoose.Types.Decimal128.fromString(
      (parseFloat(ledger.wallets.communityRewards || 0) + amount).toString()
    );
    ledger.totalRewardsCredited = mongoose.Types.Decimal128.fromString(
      (parseFloat(ledger.totalRewardsCredited || 0) + amount).toString()
    );

    await ledger.save();

    // LedgerRow entry
    creditRows.push({
      userId: reward.userId,
      eventType: type,
      walletTo: "COMMUNITY_REWARDS",
      amount: reward.amount,
      narrative: reward.narrative,
    });

    // Mark reward processed
    reward.creditProcessed = true;
    await reward.save();

    creditedCount++;
  }

  // Process all rewards
  for (const r of pendingLP)    await applyCredit(r, "DAILY_REWARDS_LP");
  for (const r of pendingAir)   await applyCredit(r, "DAILY_REWARDS_AIRDROP");
  for (const r of pendingBoost) await applyCredit(r, "DAILY_REWARDS_BOOST");

  // Bulk insert ledger rows
  if (creditRows.length > 0) {
    await LedgerRow.insertMany(creditRows, { ordered: false });
  }

  console.log(`
==================== CREDIT SUMMARY ====================
💠 LP Rewards Credited:      ${pendingLP.length}
💠 Airdrop Rewards Credited: ${pendingAir.length}
💠 Boost Rewards Credited:   ${pendingBoost.length}
--------------------------------------------------------
🎉 TOTAL Rewards Credited:   ${creditedCount}
========================================================
`);

  await mongoose.disconnect();
  
}

creditComputedRewards();
