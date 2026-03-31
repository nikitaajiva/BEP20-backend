/**
 * RUN:
 * node scripts/audit/teamDailyExcelReport.js <UHID> <YYYY-MM-DD>
 *
 * Example:
 * node scripts/audit/teamDailyExcelReport.js 1764328506978 2025-12-01
 */

const moment = require("moment");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const connectDB = require("../../config/db");
const User = require("../../models/User");
const Level = require("../../models/Level");
const LedgerRow = require("../../models/LedgerRow");

const PASSED_UHID = String(process.argv[2]);
const DATE = process.argv[3];

if (!PASSED_UHID || !DATE) {
  console.error("❌ Usage: node teamDailyExcelReport.js <UHID> <YYYY-MM-DD>");
  process.exit(1);
}

const REPORTS_DIR = path.resolve(__dirname, "../../reports");
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

(async () => {
  try {
    await connectDB();
    

    /* =====================================================
       STEP 1: FETCH TEAM UHIDs FROM LEVELS (NO EXTRA FILTERS)
    ===================================================== */
    const levelDocs = await Level.find(
      { parent: PASSED_UHID },     // 🔥 EXACT MATCH
      { child: 1 }
    ).lean();

    

    const teamUHIDs = [
      PASSED_UHID,                       // SELF
      ...levelDocs.map(l => String(l.child)), // TEAM
    ];

    

    /* =====================================================
       STEP 2: FETCH USERS FOR THESE UHIDs
    ===================================================== */
    const users = await User.find(
      { uhid: { $in: teamUHIDs } },
      { _id: 1, username: 1, uhid: 1, xrpAddress: 1 }
    ).lean();

    

    if (!users.length) {
      throw new Error("No users found for these UHIDs");
    }

    const userMap = {};
    const userIds = [];

    users.forEach(u => {
      userMap[u._id.toString()] = {
        username: u.username,
        uhid: String(u.uhid),
        xrpAddress: u.xrpAddress || "",
        deposited: 0,
        withdrawal: 0,
        redeemed: 0,
      };
      userIds.push(u._id);
    });

    /* =====================================================
       STEP 3: DATE RANGE (UTC)
    ===================================================== */
    const start = moment.utc(DATE).startOf("day").toDate();
    const end = moment.utc(DATE).endOf("day").toDate();

    /* =====================================================
       STEP 4: LEDGER AGGREGATION
    ===================================================== */
    const ledgerAgg = await LedgerRow.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          ts: { $gte: start, $lte: end },
          $or: [
            { eventType: "DEPOSIT", walletFrom: "EXTERNAL", walletTo: "XAMAN" },
            { eventType: "WITHDRAWAL", walletFrom: "ZERO_RISK", walletTo: "EXTERNAL" },
            { eventType: "REWARDS_REDEEMED", walletFrom: "COMMUNITY_REWARDS", walletTo: "EXTERNAL" },
          ],
        },
      },
      {
        $group: {
          _id: { userId: "$userId", eventType: "$eventType" },
          amount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    

    ledgerAgg.forEach(r => {
      const uid = r._id.userId.toString();
      if (!userMap[uid]) return;

      if (r._id.eventType === "DEPOSIT") userMap[uid].deposited = r.amount;
      if (r._id.eventType === "WITHDRAWAL") userMap[uid].withdrawal = r.amount;
      if (r._id.eventType === "REWARDS_REDEEMED") userMap[uid].redeemed = r.amount;
    });

    /* =====================================================
       STEP 5: CREATE EXCEL
    ===================================================== */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Team Daily Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 22 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "XRP Address", key: "xrpAddress", width: 42 },
      { header: "Deposited", key: "deposited", width: 15 },
      { header: "Withdrawal", key: "withdrawal", width: 15 },
      { header: "Redeemed", key: "redeemed", width: 15 },
      { header: "Date (UTC)", key: "date", width: 14 },
    ];

    Object.values(userMap).forEach(u => {
      sheet.addRow({
        username: u.username,
        uhid: u.uhid,
        xrpAddress: u.xrpAddress,
        deposited: u.deposited.toFixed(6),
        withdrawal: u.withdrawal.toFixed(6),
        redeemed: u.redeemed.toFixed(6),
        date: DATE,
      });
    });

    const filePath = path.join(
      REPORTS_DIR,
      `Team_Daily_Report_${PASSED_UHID}_${DATE}.xlsx`
    );

    await workbook.xlsx.writeFile(filePath);

    
    

    process.exit(0);
  } catch (err) {
    console.error("❌ Report failed:", err.message);
    process.exit(1);
  }
})();
