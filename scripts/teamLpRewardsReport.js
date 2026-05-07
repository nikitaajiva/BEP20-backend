/**
 * Generate Team LP Rewards report for a given sponsor UHID
 * Usage:
 *   node scripts/teamLpRewardsReport.js <UHID> [YYYY-MM-DD]
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

// Models
const connectDB = require("../config/db");
const User = require("../models/User");
const Level = require("../models/Level");
const LpReward = require("../models/LpReward");

(async () => {
  try {
    await connectDB();

    const uhid = process.argv[2];
    const passedDate = process.argv[3];

    if (!uhid) {
      
      process.exit(1);
    }

    // Find sponsor user
    const parentUser = await User.findOne({ uhid }).lean();
    if (!parentUser) {
      
      process.exit(0);
    }

    const reportDate = passedDate ? moment.utc(passedDate, "YYYY-MM-DD") : moment.utc();
    const startOfDay = reportDate.clone().startOf("day").toDate();
    const endOfDay = reportDate.clone().endOf("day").toDate();

    

    // Get all level entries where this user is parent
    const levelLinks = await Level.find({ parent: uhid }).lean();
    const childUHIDs = levelLinks.map(l => l.child);
    if (!childUHIDs.length) {
      
      process.exit(0);
    }

    // Find child users
    const childUsers = await User.find({ uhid: { $in: childUHIDs } }, { _id: 1, uhid: 1, username: 1, name: 1 }).lean();
    const childIds = childUsers.map(u => u._id);
    const childMap = {};
    childUsers.forEach(u => (childMap[u._id.toString()] = u));

    if (!childIds.length) {
      
      process.exit(0);
    }

    // Find LP Rewards for these child users
    const rewards = await LpReward.find({
      userId: { $in: childIds },
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!rewards.length) {
      
      process.exit(0);
    }

    

    // Prepare Excel rows
    const rows = [];
    let total = 0;

    rewards.forEach((r, i) => {
      const userObj = childMap[r.userId.toString()] || {};
      const childUHID = userObj.uhid || "N/A";
      const childName = userObj.username || userObj.name || "N/A";
      const rate = parseFloat(r.rate?.$numberDecimal || r.rate || 0);
      const amount = parseFloat(r.amount?.$numberDecimal || r.amount || 0);
      const narrative = r.narrative || "";
      const ts = moment.utc(r.createdAt).format("YYYY-MM-DD HH:mm:ss [UTC]");

      total += amount;

      console.log(
        `${i + 1}. Child: ${childUHID} (${childName}) | Amount: ${amount.toFixed(6)} | Rate: ${(rate * 100).toFixed(2)}% | ${ts}`
      );

      rows.push({
        ParentUHID: uhid,
        ParentName: parentUser.username || parentUser.name || "N/A",
        ChildUHID: childUHID,
        ChildName: childName,
        Rate: (rate * 100).toFixed(2),
        Amount: amount.toFixed(6),
        Narrative: narrative,
        Timestamp: ts,
      });
    });

    // --- Ensure /reports/ folder exists ---
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // --- Create Excel workbook ---
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Team LP Rewards");

    sheet.columns = [
      { header: "ParentUHID", key: "ParentUHID", width: 15 },
      { header: "ParentName", key: "ParentName", width: 20 },
      { header: "ChildUHID", key: "ChildUHID", width: 15 },
      { header: "ChildName", key: "ChildName", width: 20 },
      { header: "Rate (%)", key: "Rate", width: 10 },
      { header: "Amount", key: "Amount", width: 15 },
      { header: "Narrative", key: "Narrative", width: 50 },
      { header: "Timestamp", key: "Timestamp", width: 25 },
    ];

    rows.forEach(r => sheet.addRow(r));

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { horizontal: "center" };

    const totalRow = sheet.addRow({
      ParentUHID: "",
      ParentName: "",
      ChildUHID: "",
      ChildName: "",
      Rate: "TOTAL",
      Amount: total.toFixed(6),
    });
    totalRow.font = { bold: true };
    totalRow.getCell("Rate").alignment = { horizontal: "right" };

    // Save Excel file inside /reports/
    const fileName = `team_lp_rewards_${uhid}_${reportDate.format("YYYY-MM-DD")}.xlsx`;
    const filePath = path.join(reportsDir, fileName);
    await workbook.xlsx.writeFile(filePath);

    
    

    process.exit(0);
  } catch (err) {
    console.error("❌ Error generating team LP rewards report:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
