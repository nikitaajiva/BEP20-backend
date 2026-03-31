// node scripts/fixZeroRiskDebit_NoEntries.js --date=2025-12-09
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Ledger = require("../models/Ledger");
const EventRewardCredit = require("../models/EventRewardCredit");

const EVENT_NAME = "MACAU_HK_EVENT";

// --------------------------------------------------------
// Parse CLI date
// --------------------------------------------------------
function getTargetDate() {
  const arg = process.argv.find(a => a.startsWith("--date="));
  if (!arg) throw new Error("❌ Please pass --date=YYYY-MM-DD");
  return arg.split("=")[1];
}

async function run() {
  await connectDB();
  

  const TARGET_DATE = getTargetDate();
  

  // --------------------------------------------------------
  // 1️⃣ Get all users who redeemed something on that date
  // --------------------------------------------------------
  const credits = await EventRewardCredit.find({
    date: TARGET_DATE,
    event: EVENT_NAME,
    redeemed: { $gt: 0 }
  });

  

  let fixed = 0;
  let skipped = 0;

  for (const evt of credits) {
    try {
      const userId = evt.userId;
      const redeemedAmount = parseFloat(evt.redeemed.toString() || "0");

      const ledger = await Ledger.findOne({ userId });
      if (!ledger) {
        
        skipped++;
        continue;
      }

      let zeroRisk = parseFloat(ledger.wallets.zeroRisk?.toString() || "0");

      if (zeroRisk <= 0) {
        
        skipped++;
        continue;
      }

      // Amount to deduct
      const deductAmt = Math.min(zeroRisk, redeemedAmount);

      if (deductAmt <= 0) {
        
        skipped++;
        continue;
      }

      // --------------------------------------------------------
      // 2️⃣ Deduct ZERO_RISK ONLY. No ledger entry creation.
      // --------------------------------------------------------
      ledger.wallets.zeroRisk = (zeroRisk - deductAmt).toFixed(6);
      await ledger.save();

      
      fixed++;

    } catch (err) {
      
      skipped++;
    }
  }

  // --------------------------------------------------------
  // Summary
  // --------------------------------------------------------
  
  
  
  

  process.exit(0);
}

run();
