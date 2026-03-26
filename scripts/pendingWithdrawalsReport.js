/**
 * Script: pendingWithdrawalsReport.js
 *
 * Usage:
 *   node scripts/pendingWithdrawalsReport.js
 *   node scripts/pendingWithdrawalsReport.js --date 2025-12-19
 *   node scripts/pendingWithdrawalsReport.js --from 2025-12-01 --to 2025-12-05
 *   node scripts/pendingWithdrawalsReport.js --walletFrom COMMUNITY_REWARDS
 *   node scripts/pendingWithdrawalsReport.js --limit 100
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const User = require("../models/User");

// --------------------------------------------------
// CLI ARG HELPERS
// --------------------------------------------------
const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
};

const DATE_SINGLE = getArgValue("--date");
const DATE_FROM = getArgValue("--from");
const DATE_TO = getArgValue("--to");
const WALLET_FROM = getArgValue("--walletFrom");

const LIMIT = (() => {
  const v = Number(getArgValue("--limit"));
  return isNaN(v) ? null : v;
})();

// --------------------------------------------------
// DATE HELPERS (UTC SAFE)
// --------------------------------------------------
function parseDateInput(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

let dateStart, dateEnd;

// Single date
if (DATE_SINGLE) {
  const d = parseDateInput(DATE_SINGLE);
  if (!d) {
    console.error("❌ Invalid --date (use YYYY-MM-DD)");
    process.exit(1);
  }
  dateStart = d;
  dateEnd = new Date(d);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
}

// Range
else if (DATE_FROM && DATE_TO) {
  const d1 = parseDateInput(DATE_FROM);
  const d2 = parseDateInput(DATE_TO);
  if (!d1 || !d2) {
    console.error("❌ Invalid --from / --to (use YYYY-MM-DD)");
    process.exit(1);
  }
  dateStart = d1;
  dateEnd = new Date(d2);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
}

// Default: TODAY UTC
else {
  const now = new Date();
  dateStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  dateEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// --------------------------------------------------
// MAIN
// --------------------------------------------------
async function start() {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");

    const query = {
      errorCode: { $ne: "RESOLVED" },
      createdAt: { $gte: dateStart, $lt: dateEnd },
    };

    if (WALLET_FROM) {
      query.walletFrom = WALLET_FROM;
      console.log(`🎯 walletFrom filter: ${WALLET_FROM}`);
    }

    let logs = await WithdrawalErrorLog.find(query).lean();

    if (LIMIT && logs.length > LIMIT) logs.length = LIMIT;

    console.log(`📌 Pending records found: ${logs.length}`);

    // --------------------------------------------------
    // EXCEL SETUP
    // --------------------------------------------------
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pending Withdrawals");

    sheet.columns = [
      { header: "Username", key: "username", width: 20 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "Amount (XRP)", key: "amount", width: 18 },
      { header: "Wallet From", key: "walletFrom", width: 22 },
      { header: "XRP Address", key: "xrpAddress", width: 40 },
      { header: "Created Date (UTC)", key: "date", width: 25 },
    ];

    sheet.getRow(1).font = { bold: true };

    // --------------------------------------------------
    // DATA ROWS
    // --------------------------------------------------
    for (const log of logs) {
      const user = await User.findById(log.userId)
        .select("username uhid")
        .lean();

      sheet.addRow({
        username: user?.username || "N/A",
        uhid: user?.uhid || "N/A",
        amount: Number(log.amount).toFixed(6),
        walletFrom: log.walletFrom || "N/A",
        xrpAddress: log.destinationAddress || "N/A",
        date: log.createdAt?.toISOString(),
      });
    }

    // --------------------------------------------------
    // SAVE FILE
    // --------------------------------------------------
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    const fileName = `pending_withdrawals_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    const filePath = path.join(reportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    console.log(`✅ Report generated: ${filePath}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Report generation failed:", err);
    process.exit(1);
  }
}

start();
