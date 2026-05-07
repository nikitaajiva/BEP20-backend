/**
 * Script: reprocessWithdrawals.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const connectDB = require("../config/db");
const { sendXrp } = require("../utils/xrpTransactions");

const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const LedgerRow = require("../models/LedgerRow");
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const Level = require("../models/Level");

/* ================= TEAM CONFIG ================= */
const ROOT_UHID_ACCESS = {
  "1757359069852": false, // root self blocked, team allowed
  "1753898284391": true,  // root + team allowed
};

/* ================= FLAGS ================= */
const TEAM_ONLY = true; // 🔒 HARD LOCK

const DRY_MODE = process.argv.includes("--dry");
const FORCE_RETRY = process.argv.includes("--force-retry");

/* ================= SUMMARY ================= */
const summary = {
  pendingCount: 0,
  pendingAmount: 0,

  sentCount: 0,
  sentAmount: 0,

  failedCount: 0,
  failedAmount: 0,

  // TEAM
  teamPendingCount: 0,
  teamPendingAmount: 0,
  teamPendingUsers: {},

  // DRY RUN
  dryRunCount: 0,
  dryRunAmount: 0,
  teamDryRunCount: 0,
  teamDryRunAmount: 0,
};

/* ================= HELPERS ================= */
function trackTeamPending(summary, user, amount, isDry = false) {
  if (!user) return;
  const uid = user._id.toString();

  if (!summary.teamPendingUsers[uid]) {
    summary.teamPendingUsers[uid] = {
      userId: uid,
      uhid: user.uhid,
      username: user.username || "N/A",
      count: 0,
      amount: 0,
      dryCount: 0,
      dryAmount: 0,
    };
  }

  summary.teamPendingUsers[uid].count++;
  summary.teamPendingUsers[uid].amount += amount;

  summary.teamPendingCount++;
  summary.teamPendingAmount += amount;

  if (isDry) {
    summary.teamPendingUsers[uid].dryCount++;
    summary.teamPendingUsers[uid].dryAmount += amount;
    summary.teamDryRunCount++;
    summary.teamDryRunAmount += amount;
  }
}

/* ================= EXCEL EXPORT ================= */
async function exportTeamDryRunExcel(summary) {
  if (!Object.keys(summary.teamPendingUsers).length) return;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Team Pending (Dry Run)");

  sheet.columns = [
    { header: "User ID", key: "userId", width: 28 },
    { header: "UHID", key: "uhid", width: 18 },
    { header: "Username", key: "username", width: 22 },
    { header: "Pending Count", key: "count", width: 16 },
    { header: "Pending Amount", key: "amount", width: 18 },
    { header: "Dry Count", key: "dryCount", width: 16 },
    { header: "Dry Amount", key: "dryAmount", width: 18 },
  ];

  let tCount = 0, tAmt = 0, dCount = 0, dAmt = 0;

  Object.values(summary.teamPendingUsers).forEach(u => {
    if (!u.dryCount) return;
    sheet.addRow(u);
    tCount += u.count;
    tAmt += u.amount;
    dCount += u.dryCount;
    dAmt += u.dryAmount;
  });

  sheet.addRow({});
  sheet.addRow({
    username: "TOTAL",
    count: tCount,
    amount: tAmt,
    dryCount: dCount,
    dryAmount: dAmt,
  }).font = { bold: true };

  const reportsDir = path.join(__dirname, "../reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  const filePath = path.join(
    reportsDir,
    `team_pending_dry_run_${new Date().toISOString().slice(0,10)}.xlsx`
  );

  await workbook.xlsx.writeFile(filePath);
  
}

/* ================= MAIN ================= */
async function start() {
  await connectDB();
  

  /* -------- TEAM USERS -------- */
  const teamRows = await Level.find(
    { parent: { $in: Object.keys(ROOT_UHID_ACCESS) } },
    { child: 1 }
  ).lean();

  const teamUhids = new Set(teamRows.map(r => String(r.child)));
  

  /* -------- LOAD PENDING LOGS -------- */
  // const logs = await WithdrawalErrorLog.find({
  //   errorCode: { $ne: "RESOLVED" },
  // }).lean();

  const startDate = new Date("2026-01-15T00:00:00.000Z"); // 15 Jan UTC
const endDate = new Date(); // now (UTC)

const logs = await WithdrawalErrorLog.find({
  errorCode: { $ne: "RESOLVED" },
  createdAt: {
    $gte: startDate,
    $lte: endDate,
  },
}).lean();


  

  for (const log of logs) {
    const amountXrp = Number(log.amount);
    const user = await User.findById(log.userId, { uhid: 1, username: 1 }).lean();
    const isTeamUser = user?.uhid && teamUhids.has(String(user.uhid));
    // 🔒 TEAM-ONLY ENFORCEMENT
if (TEAM_ONLY && !isTeamUser) {
  continue; // 🚫 skip non-team users completely
}


    if (DRY_MODE) {
      summary.pendingCount++;
      summary.pendingAmount += amountXrp;

      summary.dryRunCount++;
      summary.dryRunAmount += amountXrp;

      if (isTeamUser) {
        trackTeamPending(summary, user, amountXrp, true);
      }
      continue;
    }

    /* ---- LIVE MODE ---- */
    try {
  const result = await sendXrp({
    destination: log.destinationAddress,
    amount_xrp: amountXrp,
    DestinationTag: 200001, 
    memo: `withdrawal:${log._id}`,
  });

      if (result?.txHash) {
        summary.sentCount++;
        summary.sentAmount += amountXrp;
        await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
          status: "COMPLETED",
          errorCode: "RESOLVED",
          txHash: result.txHash,
        });
      } else {
        throw new Error("TX failed");
      }
    } catch (err) {
      
      summary.failedCount++;
      summary.failedAmount += amountXrp;

      if (isTeamUser) {
        trackTeamPending(summary, user, amountXrp, false);
      }
    }
   // process.exit(0);
  }

  /* -------- SUMMARY -------- */
  console.log(`
================ SUMMARY =================
PENDING: ${summary.pendingCount} | ${summary.pendingAmount.toFixed(6)}
SENT   : ${summary.sentCount} | ${summary.sentAmount.toFixed(6)}
FAILED : ${summary.failedCount} | ${summary.failedAmount.toFixed(6)}

TEAM PENDING: ${summary.teamPendingCount}
TEAM AMOUNT : ${summary.teamPendingAmount.toFixed(6)}

DRY RUN TOTAL: ${summary.dryRunCount}
DRY RUN AMOUNT: ${summary.dryRunAmount.toFixed(6)}

TEAM DRY RUN TOTAL: ${summary.teamDryRunCount}
TEAM DRY RUN AMOUNT: ${summary.teamDryRunAmount.toFixed(6)}
=========================================
`);

  if (DRY_MODE) {
    await exportTeamDryRunExcel(summary);
  }

  process.exit(0);
}

start().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
