const mongoose = require("mongoose");
const connectDB = require("../config/db");
const WithdrawalDepositAdjustment = require("../models/WithdrawalDepositAdjustment");

async function run() {
  await connectDB();

  const existing = await WithdrawalDepositAdjustment.findOne({}).sort({
    createdAt: -1,
  });

  if (existing) {
    console.log("Seed skipped: settings document already exists.");
    await mongoose.disconnect();
    return;
  }

  await WithdrawalDepositAdjustment.create({
    negativeWithdrawal: 0,
    positiveDeposit: 0,
    note: "Seeded default settings",
  });

  console.log("Seed complete: settings document created.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Seed failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
