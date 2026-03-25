// scripts/userTransactionReport.js
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");

async function getUserChainTotals(userId) {
  const baseFilter = { userId };

  const [depositSummary] = await ChainDeposit.aggregate([
    { $match: baseFilter },
    { $group: { _id: null, totalAmount: { $sum: "$amountXRP" } } }
  ]);

  const [withdrawalSummary] = await ChainWithdrawal.aggregate([
    { $match: baseFilter },
    { $group: { _id: null, totalAmount: { $sum: "$amountXRP" } } }
  ]);

  return {
    totalDeposits: depositSummary?.totalAmount || 0,
    totalWithdrawals: withdrawalSummary?.totalAmount || 0,
  };
}

async function main() {
  try {
    const uhid = process.argv[2];
    if (!uhid) {
      console.error("Usage: node scripts/userTransactionReport.js <uhid>");
      process.exit(1);
    }

    await connectDB();
    console.log("Connected to DB");

    // Find user by UHID
    const user = await User.findOne({ uhid }).lean();
    if (!user) {
      console.error(`No user found with UHID: ${uhid}`);
      process.exit(1);
    }
    console.log(`User: ${user.username || "N/A"} (UHID: ${user.uhid})`);

    // On-chain deposit & withdrawal totals
    const { totalDeposits, totalWithdrawals } = await getUserChainTotals(user._id);
    console.log(`\nOn-chain Deposit Total: ${totalDeposits}`);
    console.log(`On-chain Withdrawal Total: ${totalWithdrawals}`);

    // Ledger & balances
    const ledger = await Ledger.findOne({ userId: user._id }).lean();
    if (!ledger) {
      console.error("No ledger found for this user.");
      process.exit(1);
    }

    const lpBalance = ledger.wallets?.lp?.toString() || "0.0";
    const xamanBalance = ledger.wallets?.xaman?.toString() || "0.0";
    const zeroRiskBalance = ledger.wallets?.zeroRisk?.toString() || "0.0";
    const communityRewardsBalance = ledger.wallets?.communityRewards?.toString() || "0.0";

    const totalRewardsWithdrawal = ledger.totalRewardsWithdrawal?.toString() || "0.0";
    const rewardsUsed = ledger.limits?.fiveXLimit?.used?.toString() || "0.0";

    console.log(`LP Balance: ${lpBalance}`);
    console.log(`XAMAN Balance: ${xamanBalance}`);
    console.log(`Zero Risk Balance: ${zeroRiskBalance}`);
    console.log(`Current Balance: ${communityRewardsBalance}`);
    console.log(`Redeemed: ${totalRewardsWithdrawal}`);
    console.log(`Rewards: ${rewardsUsed}`);

    // Autopositioning total
    const totalAutopositioning = await LedgerRow.aggregate([
      { $match: { userId: user._id, eventType: "AUTOPOSITIONING" } },
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
    ]);
    console.log(`Autopositioning Total: ${(totalAutopositioning[0]?.total || 0).toFixed(6)}`);

    await mongoose.disconnect();
    console.log("Done");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
