const mongoose = require("mongoose");
const connectDB = require("../config/db");
const WithdrawalDepositAdjustment = require("../models/WithdrawalDepositAdjustment");

async function run() {
  await connectDB();

  const existing = await WithdrawalDepositAdjustment.findOne({}).sort({
    createdAt: -1,
  });

  if (existing) {
    
    await mongoose.disconnect();
    return;
  }

  await WithdrawalDepositAdjustment.create({
    negativeWithdrawal: 0,
    positiveDeposit: 0,
    note: "Seeded default settings",
  });

  
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Seed failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
