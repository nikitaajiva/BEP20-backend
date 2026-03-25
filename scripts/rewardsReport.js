/**
 * rewardsReport.js
 * Generate a report of all users whose totalRewardsCredited >= 3000
 * Columns:
 * Username | Uhid | Total Reward Credited | Total Rewards Withdrawal | Onchain Deposit | Onchain Withdrawal
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// DB + Models
const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");

async function generateRewardsReport() {
  await connectDB();

  try {
    console.log("🔍 Fetching ledgers where totalRewardsCredited >= 3000...");
    const ledgers = await Ledger.find({
      totalRewardsCredited: { $gte: 3000 },
    }).lean();

    if (!ledgers.length) {
      console.log("⚠️ No ledgers found with totalRewardsCredited >= 3000");
      return;
    }

    console.log(`✅ Found ${ledgers.length} ledgers, fetching user details...`);
    const userIds = ledgers.map((l) => l.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select("username uhid")
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    // === Create Excel workbook ===
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Rewards Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "Uhid", key: "uhid", width: 20 },
      { header: "Total Reward Credited", key: "credited", width: 25 },
      { header: "Total Rewards Withdrawal", key: "withdrawal", width: 25 },
      { header: "Onchain Deposits", key: "onchainDeposits", width: 20 },
      { header: "Onchain Withdrawals", key: "onchainWithdrawals", width: 20 },
    ];

    console.log("⛓️  Fetching onchain data for each user...");

    for (const ledger of ledgers) {
      const userId = ledger.userId;
      const user = userMap.get(userId?.toString());
      if (!user) continue;

      // 🪙 Onchain totals (aggregate deposits & withdrawals)
      const [deposits, withdrawals] = await Promise.all([
        ChainDeposit.aggregate([
          { $match: { userId } },
          { $group: { _id: null, total: { $sum: "$amountXRP" } } },
        ]),
        ChainWithdrawal.aggregate([
          { $match: { userId } },
          { $group: { _id: null, total: { $sum: "$amountXRP" } } },
        ]),
      ]);

      const onchainDeposits = deposits.length
        ? parseFloat(deposits[0].total.toString())
        : 0;
      const onchainWithdrawals = withdrawals.length
        ? parseFloat(withdrawals[0].total.toString())
        : 0;

      sheet.addRow({
        username: user.username || "N/A",
        uhid: user.uhid || "N/A",
        credited: Number(ledger.totalRewardsCredited || 0),
        withdrawal: Number(ledger.totalRewardsWithdrawal || 0),
        onchainDeposits,
        onchainWithdrawals,
      });
    }

    // === Save Excel ===
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const fileName = `rewardsReport_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    const filePath = path.join(reportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);

    console.log(`✅ Report generated successfully: ${filePath}`);
  } catch (err) {
    console.error("❌ Error generating report:", err);
  } finally {
    mongoose.connection.close();
  }
}

// Run script
generateRewardsReport();
