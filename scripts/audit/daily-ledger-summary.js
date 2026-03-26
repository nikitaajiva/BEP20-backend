const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const moment = require("moment");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const LedgerRow = require("../../models/LedgerRow");
const User = require("../../models/User");
const connectDB = require("../../config/db");

const REPORT_DATE = process.argv[2]; // YYYY-MM-DD

if (!REPORT_DATE) {
  console.error("❌ Please pass date: YYYY-MM-DD");
  process.exit(1);
}

/* =========================
   REPORTS DIRECTORY
========================= */
const REPORTS_DIR = path.resolve(__dirname, "../../reports");

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log("📁 reports folder created");
}

(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");

    // ts is already UTC — just build range
    const start = moment.utc(REPORT_DATE).startOf("day").toDate();
    const end = moment.utc(REPORT_DATE).endOf("day").toDate();

    console.log(`📅 Audit report for ${REPORT_DATE} (UTC)`);

    const rows = await LedgerRow.aggregate([
      {
        $match: {
          ts: { $gte: start, $lte: end },
          $or: [
            {
              eventType: "DEPOSIT",
              walletFrom: "EXTERNAL",
              walletTo: "XAMAN",
            },
            {
              eventType: "WITHDRAWAL",
              walletFrom: "ZERO_RISK",
              walletTo: "EXTERNAL",
            },
            {
              eventType: "REWARDS_REDEEMED",
              walletFrom: "COMMUNITY_REWARDS",
              walletTo: "EXTERNAL",
            },
          ],
        },
      },
      {
        $group: {
          _id: {
            userId: "$userId",
            eventType: "$eventType",
          },
          totalAmount: { $sum: { $toDouble: "$amount" } },
          count: { $sum: 1 },
          firstAt: { $min: "$ts" },
          lastAt: { $max: "$ts" },
        },
      },
    ]);

    const userMap = {};

    for (const r of rows) {
      const uid = r._id.userId.toString();

      if (!userMap[uid]) {
        userMap[uid] = {
          DEPOSIT: { amount: 0, count: 0 },
          WITHDRAWAL: { amount: 0, count: 0 },
          REWARDS_REDEEMED: { amount: 0, count: 0 },
          firstAt: r.firstAt,
          lastAt: r.lastAt,
        };
      }

      userMap[uid][r._id.eventType] = {
        amount: r.totalAmount,
        count: r.count,
      };

      userMap[uid].firstAt = new Date(
        Math.min(userMap[uid].firstAt, r.firstAt)
      );
      userMap[uid].lastAt = new Date(
        Math.max(userMap[uid].lastAt, r.lastAt)
      );
    }

    const users = await User.find(
      { _id: { $in: Object.keys(userMap) } },
      { username: 1, uhid: 1, xrpAddress: 1 }
    ).lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Daily Audit");

    sheet.columns = [
      { header: "Date (UTC)", key: "date", width: 12 },
      { header: "User ID", key: "userId", width: 26 },
      { header: "Username", key: "username", width: 18 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "XRP Address", key: "xrpAddress", width: 38 },

      { header: "Deposit Amount", key: "depositAmount", width: 18 },
      { header: "Deposit Count", key: "depositCount", width: 16 },

      { header: "Withdrawal Amount", key: "withdrawAmount", width: 18 },
      { header: "Withdrawal Count", key: "withdrawCount", width: 18 },

      { header: "Rewards Redeemed Amount", key: "redeemAmount", width: 22 },
      { header: "Rewards Redeemed Count", key: "redeemCount", width: 22 },

      { header: "First Tx Time (UTC)", key: "firstAt", width: 22 },
      { header: "Last Tx Time (UTC)", key: "lastAt", width: 22 },
    ];

    for (const u of users) {
      const d = userMap[u._id.toString()];

      sheet.addRow({
        date: REPORT_DATE,
        userId: u._id.toString(),
        username: u.username,
        uhid: u.uhid,
        xrpAddress: u.xrpAddress,

        depositAmount: d.DEPOSIT.amount.toFixed(6),
        depositCount: d.DEPOSIT.count,

        withdrawAmount: d.WITHDRAWAL.amount.toFixed(6),
        withdrawCount: d.WITHDRAWAL.count,

        redeemAmount: d.REWARDS_REDEEMED.amount.toFixed(6),
        redeemCount: d.REWARDS_REDEEMED.count,

        firstAt: moment.utc(d.firstAt).format("YYYY-MM-DD HH:mm:ss"),
        lastAt: moment.utc(d.lastAt).format("YYYY-MM-DD HH:mm:ss"),
      });
    }

    const filePath = path.join(
      REPORTS_DIR,
      `Daily_Ledger_Report_${REPORT_DATE}.xlsx`
    );

    await workbook.xlsx.writeFile(filePath);

    console.log(`📊 Report saved: ${filePath}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Audit failed", err);
    process.exit(1);
  }
})();
