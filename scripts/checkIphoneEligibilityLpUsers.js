/**
 * Script: iphoneEligibilityExcelReport.js
 * PURPOSE: Generate Excel report for LP >= 1000 users (xRank empty)
 */

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const Level = require("../models/Level");

const RANGE_START = new Date("2025-12-07T00:00:00.000Z");
const RANGE_END   = new Date("2026-01-15T23:59:59.999Z");

(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");

    /* =========================================
       FIND TARGET USERS
    ========================================= */
    const users = await User.find({
      $or: [
        { xRank: null },
        { xRank: "" },
        { xRank: { $exists: false } },
      ],
    })
      .select("_id uhid username")
      .lean();

    console.log(`🔍 Users found: ${users.length}`);

    /* =========================================
       EXCEL SETUP
    ========================================= */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Eligibility Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 20 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "LP", key: "lp", width: 12 },

      { header: "Leg 1 Username", key: "leg1_username", width: 20 },
      { header: "Leg 1 Team Deposit", key: "leg1_deposit", width: 18 },

      { header: "Leg 2 Username", key: "leg2_username", width: 20 },
      { header: "Leg 2 Team Deposit", key: "leg2_deposit", width: 18 },

      { header: "Leg 3 Username", key: "leg3_username", width: 20 },
      { header: "Leg 3 Team Deposit", key: "leg3_deposit", width: 18 },
    ];

    let rowCount = 0;

    /* =========================================
       PROCESS USERS
    ========================================= */
    for (const user of users) {
      const userId = user._id;
      const parentUHID = String(user.uhid);

      const ledger = await Ledger.findOne(
        { userId },
        { "wallets.lp": 1 }
      ).lean();

      const lp = Number(ledger?.wallets?.lp?.toString() || 0);
      if (lp < 1000) continue;

      const directLegs = await Level.find(
        { parent: parentUHID, level: 1 },
        { child: 1 }
      ).lean();

      if (!directLegs.length) continue;

      const legData = [];

      for (const leg of directLegs) {
        const legUHID = String(leg.child);

        const legUser = await User.findOne(
          { uhid: legUHID },
          { _id: 1, username: 1 }
        ).lean();

        if (!legUser) continue;

        const teamLevels = await Level.find(
          { parent: legUHID },
          { child: 1 }
        ).lean();

        const teamUHIDs = [
          legUHID,
          ...teamLevels.map(l => String(l.child)),
        ];

        const teamUsers = await User.find(
          { uhid: { $in: teamUHIDs } },
          { _id: 1 }
        ).lean();

        if (!teamUsers.length) continue;

        const teamUserIds = teamUsers.map(u => u._id);

        const teamDepositAgg = await LedgerRow.aggregate([
          {
            $match: {
              userId: { $in: teamUserIds },
              eventType: "DEPOSIT",
              walletTo: "XAMAN",
              ts: { $gte: RANGE_START, $lte: RANGE_END },
            },
          },
          {
            $group: {
              _id: null,
              totalDeposit: {
                $sum: {
                  $convert: {
                    input: "$amount",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
        ]);

        const teamDeposit = teamDepositAgg[0]?.totalDeposit || 0;

        legData.push({
          username: legUser.username,
          deposit: teamDeposit,
        });
      }

      if (!legData.length) continue;

      /* Sort legs by highest deposit and take top 3 */
      legData.sort((a, b) => b.deposit - a.deposit);
      const topLegs = legData.slice(0, 3);

      sheet.addRow({
        username: user.username,
        uhid: parentUHID,
        lp,

        leg1_username: topLegs[0]?.username || "",
        leg1_deposit: topLegs[0]?.deposit || 0,

        leg2_username: topLegs[1]?.username || "",
        leg2_deposit: topLegs[1]?.deposit || 0,

        leg3_username: topLegs[2]?.username || "",
        leg3_deposit: topLegs[2]?.deposit || 0,
      });

      rowCount++;
    }

    /* =========================================
       SAVE FILE
    ========================================= */
    const reportPath = path.join(
      __dirname,
      "..",
      "reports",
      `iphone_eligibility_lp_users_${Date.now()}.xlsx`
    );

    await workbook.xlsx.writeFile(reportPath);

    console.log(`📊 Report generated`);
    console.log(`📍 Location: ${reportPath}`);
    console.log(`🧾 Rows written: ${rowCount}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Excel report error:", err);
    process.exit(1);
  }
})();
