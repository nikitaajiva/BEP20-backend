// node scripts/autoRedeemHK.js --date=2025-12-10
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const EventRewardCredit = require("../models/EventRewardCredit");

const EVENT_NAME = "MACAU_HK_EVENT";

// --------------------------------------------------------
// 📌 Parse command-line argument:  --date=YYYY-MM-DD
// --------------------------------------------------------
function getDateFromArgsOrYesterday() {
  const arg = process.argv.find(a => a.startsWith("--date="));
  if (arg) return arg.split("=")[1];

  // default to yesterday
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 1);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function run() {
  await connectDB();
  console.log("🔥 Connected to MongoDB");

  const TARGET_DATE = getDateFromArgsOrYesterday();
  console.log(`📅 Running auto-redeem HK Event for: ${TARGET_DATE}`);

  // --------------------------------------------------------
  // 1️⃣ Find all users who did NOT redeem (remaining > 0)
  // --------------------------------------------------------
  const credits = await EventRewardCredit.find({
    date: TARGET_DATE,
    event: EVENT_NAME,
    remaining: { $gt: 0 }
  });

  console.log(`🔍 Found ${credits.length} pending redemptions`);

  let successCount = 0;
  let failCount = 0;

  for (const event of credits) {
    try {
      const userId = event.userId;
      const remaining = parseFloat(event.remaining.toString());

      // --------------------------------------------------------
      // Fetch ledger
      //---------------------------------------------------------
      const ledger = await Ledger.findOne({ userId });
      if (!ledger) {
        console.log(`❌ Ledger missing for user ${userId}`);
        failCount++;
        continue;
      }

      let communityRewards = parseFloat(
        ledger.wallets.communityRewards?.toString() || "0"
      );

      // --------------------------------------------------------
      // FIX: Allow small floating-point tolerance (4+ decimals)
      // --------------------------------------------------------
      const TOLERANCE = 0.0001;
      if (communityRewards + TOLERANCE < remaining) {
        console.log(
          `❌ User ${userId} insufficient reward balance (${communityRewards}) < required (${remaining})`
        );
        failCount++;
        continue;
      }

      // --------------------------------------------------------
      // Deduct communityRewards
      // --------------------------------------------------------
      ledger.wallets.communityRewards = (communityRewards - remaining).toFixed(6);

      // --------------------------------------------------------
      // Update fiveXLimit.used
      // --------------------------------------------------------
      const used = parseFloat(ledger.limits.fiveXLimit.used?.toString() || "0");
      ledger.limits.fiveXLimit.used = (used + remaining).toFixed(6);


          // -----------------------------
    // Deduct ZERO_RISK if available
    // -----------------------------
    const zeroRiskBal = parseFloat(ledger.wallets.zeroRisk?.toString() || "0");
    let deductedFromZeroRisk = 0;

    if (zeroRiskBal > 0) {
      deductedFromZeroRisk = Math.min(remaining, zeroRiskBal);
      ledger.wallets.zeroRisk = (zeroRiskBal - deductedFromZeroRisk).toFixed(6);
    }

      // --------------------------------------------------------
      // Update totalRewardsWithdrawal
      // --------------------------------------------------------
      const totalWithdrawal = parseFloat(
        ledger.totalRewardsWithdrawal?.toString() || "0"
      );
      ledger.totalRewardsWithdrawal = (totalWithdrawal + remaining).toFixed(6);

      await ledger.save();

      // --------------------------------------------------------
      // Update EventRewardCredit record
      // --------------------------------------------------------
      const redeemedSoFar = parseFloat(event.redeemed?.toString() || "0");
      event.redeemed = (redeemedSoFar + remaining).toFixed(6);
      event.remaining = "0";
      await event.save();

      // --------------------------------------------------------
      // Insert LedgerRow entry
      // --------------------------------------------------------
      await LedgerRow.create({
        userId,
        eventType: "REWARDS_REDEEMED",
        walletFrom: "COMMUNITY_REWARDS",
        walletTo: "MACAU_HK_EVENT",
        amount: remaining,
        status: "COMPLETED",
        narrative: `Macau/HK Event auto-redeemed for ${TARGET_DATE}`,
        ts: new Date(`${TARGET_DATE}T23:59:00.000Z`),
        deductedFromZeroRisk: "0.000000"
      });

      console.log(`✔ SUCCESS: Redeemed ${remaining} for user ${userId}`);
      successCount++;

    } catch (err) {
      console.log(`⚠ ERROR for user ${event.userId}: ${err.message}`);
      failCount++;
    }
  }

  // --------------------------------------------------------
  // Summary
  // --------------------------------------------------------
  console.log("--------------------------------------------------------");
  console.log(`🎉 Successful redemptions: ${successCount}`);
  console.log(`❌ Failed redemptions: ${failCount}`);
  console.log("--------------------------------------------------------");

  process.exit(0);
}

run();
