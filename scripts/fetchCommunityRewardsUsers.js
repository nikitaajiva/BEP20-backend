/**
 * Script: fetchCommunityRewardsUsers.js
 * Usage:
 *   node scripts/fetchCommunityRewardsUsers.js
 */
/**
 * Report: Community Rewards Balance Report
 *
 * Script Path:
 *   scripts/communityRewardsReport.js
 *
 * Output Path:
 *   reports/community_rewards_report_YYYY-MM-DD.xlsx
 *
 * Usage:
 *   node scripts/communityRewardsReport.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const Levels = require("../models/Level");

/* ============================
   TEAM + LEVEL RESOLVER
============================ */
async function resolveTeamWithLevels(parent) {
  const parentUser = await User.findOne({
    $or: [
      { username: parent },
      { uhid: parent }
    ]
  }).select("uhid");

  if (!parentUser?.uhid) return null;

  const rootUhid = String(parentUser.uhid);

  // uhid -> LEVEL FROM DB
  const teamMap = new Map();

  // Parent has no Levels row
  teamMap.set(rootUhid, "SELF"); // or 0 if you prefer

  const queue = [rootUhid];

  while (queue.length) {
    const currentParent = queue.shift();

    // 🔥 KEY: fetch BOTH child and level from DB
    const rows = await Levels.find({ parent: currentParent })
      .select("child level")
      .lean();

    for (const r of rows) {
      const childUhid = String(r.child);

      if (!teamMap.has(childUhid)) {
        // ✅ USE LEVEL FROM DB (not BFS depth)
        teamMap.set(childUhid, r.level);

        queue.push(childUhid);
      }
    }
  }

  return teamMap;
}
async function updateLedgerWithdrawalFlags(allowedUhids) {
  if (!allowedUhids || !allowedUhids.size) return;

  // Get userIds for these UHIDs
  const users = await User.find(
    { uhid: { $in: Array.from(allowedUhids) } },
    { _id: 1, uhid: 1 }
  ).lean();

  const userIds = users.map(u => u._id);

  if (!userIds.length) {
    
    return;
  }

  const result = await Ledger.updateMany(
    { userId: { $in: userIds } },
    {
      $set: {
        withdrawalDisabled: false,
        pendingWithdrawal: null,
      },
    }
  );

  
  
  
}

async function run() {
  try {
    await connectDB();
    

    // -----------------------------
    // OPTIONAL: pass parent via CLI
    // node scripts/communityRewardsReport.js 1757359069852
    // -----------------------------
    const parent = process.argv[2];

    let teamMap = null;
    let allowedUhids = null;

    if (parent) {
      
      teamMap = await resolveTeamWithLevels(parent);

      if (!teamMap || !teamMap.size) {
        
        return;
      }

      allowedUhids = new Set(teamMap.keys());
    if (allowedUhids) {
      await updateLedgerWithdrawalFlags(allowedUhids);
    }

      
    }

    // ---------------------------------------
    // Fetch ledgers where communityRewards > 0
    // ---------------------------------------
    const records = await Ledger.aggregate([
      {
        $match: {
          "wallets.communityRewards": { $gt: 0 }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          username: "$user.username",
          uhid: "$user.uhid",
          communityRewards: "$wallets.communityRewards"
        }
      },
      { $sort: { communityRewards: -1 } }
    ]);

    // -----------------------------
    // APPLY TEAM FILTER (CRITICAL)
    // -----------------------------
    let finalRecords = records;

    if (allowedUhids) {
      finalRecords = records.filter(r =>
        allowedUhids.has(String(r.uhid))
      );
    }

    

    if (!finalRecords.length) {
      
      return;
    }

    // ---------------------------------------
    // Resolve /reports directory
    // ---------------------------------------
    const reportsDir = path.resolve(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // ---------------------------------------
    // Create Excel
    // ---------------------------------------
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Community Rewards");

    sheet.columns = [
      { header: "S.No", key: "sn", width: 8 },
      { header: "Username", key: "username", width: 26 },
      { header: "UHID", key: "uhid", width: 22 },
      { header: "Level", key: "level", width: 10 },
      { header: "Community Rewards", key: "communityRewards", width: 22 }
    ];

    sheet.getRow(1).font = { bold: true };

    finalRecords.forEach((r, index) => {
      sheet.addRow({
        sn: index + 1,
        username: r.username || "",
        uhid: r.uhid || "",
        level: teamMap ? `L${teamMap.get(String(r.uhid)) ?? "-"}` : "",
        communityRewards: Number(r.communityRewards)
      });
    });

    sheet.getColumn("communityRewards").numFmt = "#,##0.000000";

    // ---------------------------------------
    // Save Excel
    // ---------------------------------------
    const fileName = parent
      ? `community_rewards_${parent}_${new Date().toISOString().slice(0, 10)}.xlsx`
      : `community_rewards_report_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const outputPath = path.join(reportsDir, fileName);
    await workbook.xlsx.writeFile(outputPath);

    
    

  } catch (err) {
    console.error("❌ Report generation failed:", err);
  } finally {
    await mongoose.disconnect();
    
    process.exit(0);
  }
}

run();
