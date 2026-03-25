/**
 * Airdrop Wallet Report (Enhanced)
 * --------------------------------
 * Includes:
 *  - UHID, Username, Email
 *  - wallets.airdrop, limits.airdropLimit.cap/used
 *  - Calculated Balance (Cap - Used)
 *  - wallets.lp
 *  - users.firstLpDepositTs
 *  - Onchain Deposits (from ChainDeposits)
 *  - Onchain Withdrawals (from ChainWithdrawals)
 * --------------------------------
 * Saves to /reports/AirdropReport_<timestamp>.xlsx
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
const ChainDeposit = require("../models/ChainDeposit"); // ✅ adjust name if different
const ChainWithdrawal = require("../models/ChainWithdrawal"); // ✅ adjust name if different

async function generateAirdropReport() {
  await connectDB();

  try {
    console.log("🔍 Fetching ledgers where wallets.airdrop > 0...");

    const ledgers = await Ledger.find({
      "wallets.airdrop": { $gt: 0 },
    });

    if (!ledgers.length) {
      console.log("⚠️ No records found with airdrop > 0");
      process.exit(0);
    }

    console.log(`✅ Found ${ledgers.length} ledger(s)`);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Airdrop Wallets");

    // Columns
    sheet.columns = [
      { header: "UHID", key: "uhid", width: 18 },
      { header: "Username", key: "username", width: 22 },
      { header: "Email", key: "email", width: 30 },
      { header: "Wallet Airdrop", key: "airdrop", width: 16 },
      { header: "Airdrop Limit Cap", key: "cap", width: 18 },
      { header: "Airdrop Limit Used", key: "used", width: 18 },
      { header: "Balance (Cap - Used)", key: "balanceLeft", width: 20 },
      { header: "LP Wallet", key: "lp", width: 16 },
      { header: "First LP Deposit Ts", key: "firstLpDepositTs", width: 28 },
      { header: "Onchain Deposits", key: "onchainDeposits", width: 20 },
      { header: "Onchain Withdrawals", key: "onchainWithdrawals", width: 22 },
    ];

    ["D", "E", "F", "G", "H", "J", "K"].forEach((col) => {
      sheet.getColumn(col).numFmt = "0.000000";
    });

    let totalAirdrop = 0;

    for (const ledger of ledgers) {
      const user = await User.findById(
        ledger.userId,
        "username email uhid firstLpDepositTs"
      );
      if (!user) continue;

      const airdrop = parseFloat(ledger.wallets?.airdrop?.toString() || 0);
      const cap = parseFloat(ledger.limits?.airdropLimit?.cap?.toString() || 0);
      const used = parseFloat(ledger.limits?.airdropLimit?.used?.toString() || 0);
      const balanceLeft = parseFloat((cap - used).toFixed(6));
      const lp = parseFloat(ledger.wallets?.lp?.toString() || 0);
      totalAirdrop += airdrop;

      // 🪙 Onchain totals
      const [deposits, withdrawals] = await Promise.all([
        ChainDeposit.aggregate([
          { $match: { userId: ledger.userId } },
          { $group: { _id: null, total: { $sum: "$amountXRP" } } },
        ]),
        ChainWithdrawal.aggregate([
          { $match: { userId: ledger.userId } },
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
        uhid: user.uhid || "",
        username: user.username || "",
        email: user.email || "",
        airdrop,
        cap,
        used,
        balanceLeft,
        lp,
        firstLpDepositTs: user.firstLpDepositTs
          ? new Date(user.firstLpDepositTs).toISOString()
          : "",
        onchainDeposits,
        onchainWithdrawals,
      });
    }

    // Add total row
    const totalRow = sheet.addRow({
      username: "TOTAL",
      airdrop: totalAirdrop,
    });
    totalRow.font = { bold: true };
    sheet.mergeCells(`A${totalRow.number}:B${totalRow.number}`);

    // Prepare /reports folder
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const dateStr = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const fileName = `AirdropReport_${dateStr}.xlsx`;
    const filePath = path.join(reportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    console.log(`📊 Report generated successfully: ${filePath}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Error generating airdrop report:", err);
    process.exit(1);
  }
}

generateAirdropReport();
