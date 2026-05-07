/**
 * Script: refundCommunityRewardsAutopositioning.js
 *
 * MODES:
 *   --dry     → No DB writes, report only
 *
 * USAGE:
 *   node scripts/refundintlCommunityRewardsAutopositioning.js --dry
 *   node scripts/refundintlCommunityRewardsAutopositioning.js --date 2025-12-13 --dry
 *   node scripts/refundintlCommunityRewardsAutopositioning.js --from 2025-12-01 --to 2025-12-05
 */

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const User = require("../models/User");
const Level = require("../models/Level");

const Decimal128 = mongoose.Types.Decimal128;

/* ======================================================
   CLI
====================================================== */
const hasFlag = (f) => process.argv.includes(f);
const getArgValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const DRY_RUN = hasFlag("--dry");
const DATE_SINGLE = getArgValue("--date");
const DATE_FROM = getArgValue("--from");
const DATE_TO = getArgValue("--to");
const LIMIT = Number(getArgValue("--limit")) || null;

/* ======================================================
   ROOT ACCESS
====================================================== */
const ROOT_UHID_ACCESS = {
  "1757359069852": true,
  "1753898284391": true,
};

/* ======================================================
   STANDARD USER CHECK
====================================================== */
async function isStandardUser(user) {
  if (!user?.uhid) return false;

  const userUhid = String(user.uhid);
  const rootUhids = Object.keys(ROOT_UHID_ACCESS);

  // ROOT → NOT STANDARD
  if (rootUhids.includes(userUhid)) {
    return false;
  }

  // TEAM MEMBER → NOT STANDARD
  const isTeamMember = await Level.exists({
    parent: { $in: rootUhids },
    child: userUhid,
  });

  if (isTeamMember) {
    return false;
  }

  return true; // ✅ STANDARD USER
}

/* ======================================================
   DATE RANGE (UTC)
====================================================== */
function parseDateInput(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

let dateStart, dateEnd;

if (DATE_SINGLE) {
  const d = parseDateInput(DATE_SINGLE);
  if (!d) throw new Error("Invalid --date");
  dateStart = d;
  dateEnd = new Date(d);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
} else if (DATE_FROM && DATE_TO) {
  const d1 = parseDateInput(DATE_FROM);
  const d2 = parseDateInput(DATE_TO);
  if (!d1 || !d2) throw new Error("Invalid --from/--to");
  dateStart = d1;
  dateEnd = new Date(d2);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
} else {
  const now = new Date();
  dateStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  dateEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/* ======================================================
   MAIN
====================================================== */
async function start() {
  await connectDB();
  
  

  const query = {
    walletFrom: "COMMUNITY_REWARDS",
    errorCode: { $ne: "RESOLVED" },
    createdAt: { $gte: dateStart, $lt: dateEnd },
  };

  let logs = await WithdrawalErrorLog.find(query).lean();
  if (LIMIT) logs.length = Math.min(logs.length, LIMIT);

  

  /* ======================================================
     EXCEL REPORT
  ====================================================== */
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("COMMUNITY_REWARDS Refund Preview");

  sheet.columns = [
    { header: "Username", key: "username", width: 20 },
    { header: "UHID", key: "uhid", width: 18 },
    { header: "User Type", key: "userType", width: 18 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "CR Before", key: "crBefore", width: 18 },
    { header: "LP Before", key: "lpBefore", width: 18 },
    { header: "LP After", key: "lpAfter", width: 18 },
    { header: "Mode", key: "mode", width: 10 },
    { header: "Date", key: "date", width: 25 },
  ];

  sheet.getRow(1).font = { bold: true };

  for (const log of logs) {
    const ledger = await Ledger.findOne({ userId: log.userId });
    if (!ledger) continue;

    const user = await User.findById(log.userId)
      .select("username uhid")
      .lean();

    if (!user) continue;

    const standardUser = await isStandardUser(user);

    const amt = Number(log.amount);
    const crBefore = Number(ledger.wallets.communityRewards || 0);
    const lpBefore = Number(ledger.wallets.lp || 0);
    const lpAfter = lpBefore + amt;

    sheet.addRow({
      username: user.username || "N/A",
      uhid: user.uhid || "N/A",
      userType: standardUser ? "STANDARD" : "NON_STANDARD",
      amount: amt.toFixed(6),
      crBefore: crBefore.toFixed(6),
      lpBefore: lpBefore.toFixed(6),
      lpAfter: lpAfter.toFixed(6),
      mode: DRY_RUN ? "DRY" : "LIVE",
      date: log.createdAt.toISOString(),
    });

    /* ======================================================
       SKIP NON-STANDARD USERS
    ====================================================== */
    if (!standardUser) {
      console.log(
        `⏭️ Skipped autopositioning for NON-STANDARD user: ${user.username} (${user.uhid})`
      );

      if (!DRY_RUN) {
        await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
          remarks: "Skipped: Non-standard user (root or team)",
          updatedAt: new Date(),
        });
      }

      continue;
    }

    /* ================= LIVE MODE ================= */
    if (!DRY_RUN) {
      const exists = await LedgerRow.findOne({
        userId: log.userId,
        eventType: "AUTOPOSITIONING",
        walletFrom: "COMMUNITY_REWARDS",
        walletTo: "LP",
        narrative: "Rewards Redeem Refund Autopositioning to LP",
        createdAt: { $gte: log.createdAt },
      });

      if (exists) continue;

      ledger.wallets.lp = Decimal128.fromString(lpAfter.toString());
      ledger.withdrawalDisabled = false;
      ledger.pendingWithdrawal = null;
      await ledger.save();

      await LedgerRow.create({
        userId: log.userId,
        eventType: "AUTOPOSITIONING",
        walletFrom: "COMMUNITY_REWARDS",
        walletTo: "LP",
        amount: Decimal128.fromString(amt.toString()),
        narrative: "Rewards Redeem Refund Autopositioning to LP",
        status: "COMPLETED",
        createdAt: new Date(),
      });

      await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
        status: "COMPLETED",
        errorCode: "RESOLVED",
        remarks: "COMMUNITY_REWARDS refund autopositioned to LP",
        updatedAt: new Date(),
      });
    }
  }

  /* ======================================================
     SAVE REPORT
  ====================================================== */
  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  const fileName = `community_rewards_refund_${DRY_RUN ? "DRY" : "LIVE"}_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  const filePath = path.join(reportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  
  
  process.exit(0);
}

start().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
