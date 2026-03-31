"use strict";

/**
 * Community Rewards History Report
 * - Users with wallets.communityRewards > 5
 * - Includes UHID + Username
 * - Excel export
 */

require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");

const connectDB = require("../../config/db");
const Ledger = require("../../models/Ledger");
const User = require("../../models/User");

const Decimal128 = mongoose.Types.Decimal128;

(async () => {
  try {
    await connectDB();
    

    const THRESHOLD = Decimal128.fromString("5");

    // ---------------------------
    // Fetch ledgers
    // ---------------------------
    const ledgers = await Ledger.find({
      "wallets.communityRewards": { $gt: THRESHOLD }
    }).lean();

    if (!ledgers.length) {
      
      process.exit(0);
    }

    const userIds = ledgers.map(l => l.userId);

    // ---------------------------
    // Fetch user details
    // ---------------------------
    const users = await User.find(
      { _id: { $in: userIds } },
      { uhid: 1, username: 1 }
    ).lean();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = {
        uhid: u.uhid || "",
        username: u.username || ""
      };
    });

    // ---------------------------
    // Prepare rows
    // ---------------------------
    const rows = ledgers.map(l => {
      const user = userMap[l.userId.toString()] || {};
      return {
        uhid: user.uhid || "",
        username: user.username || "",
        userId: l.userId.toString(),
        communityRewards: parseFloat(
          l.wallets.communityRewards?.toString() || "0"
        )
      };
    });

    // ---------------------------
    // Excel generation
    // ---------------------------
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("CommunityRewardsHistory");

    sheet.columns = [
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Username", key: "username", width: 25 },
      { header: "User ID", key: "userId", width: 28 },
      { header: "Community Rewards", key: "communityRewards", width: 25 }
    ];

    rows.forEach(r => sheet.addRow(r));

    sheet.getColumn("communityRewards").numFmt = "0.00";

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    // ---------------------------
    // Save file
    // ---------------------------
    const today = new Date().toISOString().split("T")[0];
    const filePath = path.join(
      __dirname,
      `community_rewards_history_${today}.xlsx`
    );

    await workbook.xlsx.writeFile(filePath);

    
    
    

    process.exit(0);
  } catch (err) {
    console.error("❌ Report generation failed:", err);
    process.exit(1);
  }
})();
