/**
 * Fix missing users.firstLpDepositTs
 * ----------------------------------
 * Conditions:
 *  - User has no firstLpDepositTs set
 *  - User's Ledger shows wallets.lp > 0
 *  - User has LP_DEPOSIT_FROM_XAMAN in ledgerrows
 *
 * Run: node scripts/fixFirstLpDepositTs.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");

(async () => {
  await connectDB();

  console.log("🚀 Searching for users with missing firstLpDepositTs...");

  // 1️⃣ Find ledgers where LP wallet > 0
  const ledgers = await Ledger.find({
    "wallets.lp": { $gt: 0 },
  }).select("userId wallets.lp");

  const userIds = ledgers.map(l => l.userId);

  // 2️⃣ Find users missing firstLpDepositTs among those
  const users = await User.find({
    _id: { $in: userIds },
    $or: [{ firstLpDepositTs: { $exists: false } }, { firstLpDepositTs: null }],
  });

  console.log(`🔍 Found ${users.length} users missing firstLpDepositTs & LP > 0`);

  let updated = 0;

  for (const user of users) {
    // 3️⃣ Find earliest LP_DEPOSIT_FROM_XAMAN
    const firstDeposit = await LedgerRow.findOne({
      userId: user._id,
      eventType: "LP_DEPOSIT_FROM_XAMAN",
    })
      .sort({ ts: 1 })
      .select("ts");

    if (firstDeposit) {
      await User.updateOne(
        { _id: user._id },
        { $set: { firstLpDepositTs: firstDeposit.ts } }
      );
      updated++;
      console.log(
        `✅ ${user.username || user.email || user._id} → firstLpDepositTs = ${firstDeposit.ts.toISOString()}`
      );
    }
  }

  console.log(`\n🎯 Total users updated: ${updated}`);
  await mongoose.connection.close();
  process.exit(0);
})();
