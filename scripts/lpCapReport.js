/**
 * LP Cap Report Generator
 * -------------------------------------
 * Exports users' LP balances and limit details:
 * - username
 * - uhid
 * - wallets.lp
 * - limits.lpLimit.cap
 * - limits.lpLimit.used
 * - users.firstLpDepositTs
 * -------------------------------------
 * Saves to /reports/LpCapReport_<timestamp>.xlsx
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Import DB + Models
const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");
const User = require("../models/User");

async function generateLpCapReport() {
  await connectDB();

  try {
    

     const ledgers = await Ledger.find({
      "wallets.lp": { $exists: true, $ne: null },
      "limits.lpLimit.cap": { $exists: true, $ne: null },
      $expr: {
        $gt: ["$wallets.lp", "$limits.lpLimit.cap"],
      },
    });

    if (!ledgers.length) {
      
      process.exit(0);
    }

    

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("LP Cap Report");

    // Columns
    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "LP Balance", key: "lp", width: 18 },
      { header: "LP Limit Cap", key: "lpCap", width: 18 },
      { header: "LP Limit Used", key: "lpUsed", width: 18 },
      { header: "First LP Deposit Ts", key: "firstLpDepositTs", width: 30 },
    ];

    // Numeric formatting
    ["C", "D", "E"].forEach((col) => {
      sheet.getColumn(col).numFmt = "0.000000";
    });

    for (const ledger of ledgers) {
      const user = await User.findById(
        ledger.userId,
        "username uhid firstLpDepositTs"
      );
      if (!user) continue;

      const lp = parseFloat(ledger.wallets?.lp?.toString() || 0);
      const lpCap = parseFloat(ledger.limits?.lpLimit?.cap?.toString() || 0);
      const lpUsed = parseFloat(ledger.limits?.lpLimit?.used?.toString() || 0);

      sheet.addRow({
        username: user.username || "",
        uhid: user.uhid || "",
        lp,
        lpCap,
        lpUsed,
        firstLpDepositTs: user.firstLpDepositTs
          ? new Date(user.firstLpDepositTs).toISOString()
          : "",
      });
    }

    // Save to /reports folder
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const fileName = `LpCapReport_${timestamp}.xlsx`;
    const filePath = path.join(reportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);
    

    process.exit(0);
  } catch (err) {
    console.error("❌ Error generating LP cap report:", err);
    process.exit(1);
  }
}

generateLpCapReport();
