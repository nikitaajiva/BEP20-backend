// scripts/getTeamCommunityBalance.js
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const Level = require("../models/Level");

async function processUser(uhid, generateExcel = true, showLog = true) {
  const parentUser = await User.findOne({ uhid }).select("_id uhid username").lean();
  if (!parentUser) {
    if (showLog) console.log(`❌ No user found for UHID: ${uhid}`);
    return { teamCount: 0, totalCommunityBalance: 0, parentSelfLp: 0 };
  }

  // 🧮 Parent self LP
  const parentLedger = await Ledger.findOne({ userId: parentUser._id })
    .select("wallets.lp")
    .lean();
  const parentSelfLp =
    parentLedger?.wallets?.lp != null ? Number(parentLedger.wallets.lp) : 0;

  await User.updateOne(
    { _id: parentUser._id },
    { $set: { "counters.selfLp": parentSelfLp } }
  );

  // 👶 Children
  const children = await Level.find({ parent: uhid }).lean();
  const childUhids = [...new Set(children.map((c) => c.child))];

  let userData = [];
  let totalCommunityBalance = 0;

  if (childUhids.length > 0) {
    const users = await User.find({ uhid: { $in: childUhids } })
      .select("_id uhid username")
      .lean();
    const userIds = users.map((u) => u._id);

    if (userIds.length > 0) {
      const ledgers = await Ledger.find({ userId: { $in: userIds } })
        .select("userId wallets.lp")
        .lean();
      const ledgerMap = new Map(ledgers.map((l) => [String(l.userId), l]));

      userData = users.map((u) => {
        const l = ledgerMap.get(String(u._id));
        const lp = l?.wallets?.lp != null ? Number(l.wallets.lp) : 0;
        return {
          uhid: u.uhid,
          username: u.username || "-",
          userId: u._id.toString(),
          lp,
        };
      });

      totalCommunityBalance = userData.reduce((sum, u) => sum + (u.lp || 0), 0);

      // Bulk update selfLp for children
      const ops = userData.map((u) => ({
        updateOne: {
          filter: { _id: u.userId },
          update: { $set: { "counters.selfLp": u.lp } },
        },
      }));
      if (ops.length > 0) {
        await User.bulkWrite(ops);
      }
    }
  }

  // 🧮 Update parent's totalTeamLp
  await User.updateOne(
    { _id: parentUser._id },
    { $set: { "counters.totalTeamLp": totalCommunityBalance } }
  );

  if (showLog) {
    console.log(
      `✅ Processed UHID ${uhid} | selfLp=${parentSelfLp} | teamLp=${totalCommunityBalance} | teamCount=${userData.length}`
    );
  }

  // 📤 Write Excel only if single UHID
  if (generateExcel) {
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Team LP");

    worksheet.columns = [
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Username", key: "username", width: 25 },
      { header: "User ID", key: "userId", width: 30 },
      { header: "LP Balance", key: "lp", width: 15 },
    ];

    userData.forEach((row) => worksheet.addRow(row));
    worksheet.addRow({});
    worksheet.addRow({
      uhid: "TOTAL",
      username: "",
      userId: `Team Count: ${userData.length}`,
      lp: totalCommunityBalance,
    });

    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    const filePath = path.join(reportsDir, `team_lp_${uhid}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    console.log(`📦 Excel exported: ${filePath}`);
  }

  return { teamCount: userData.length, totalCommunityBalance, parentSelfLp };
}

async function main() {
  await connectDB();
  try {
    const uhid = process.argv[2];

    if (uhid) {
      // Single user → Excel + log
      const result = await processUser(uhid, true, true);
      console.log("📊 Summary:", result);
    } else {
      // Bulk mode → all users, no Excel
      const allUsers = await User.find({}).select("uhid").lean();
      console.log(`🔄 Processing ${allUsers.length} users...`);

      let i = 0;
      for (const u of allUsers) {
        i++;
        await processUser(u.uhid, false, true);
        console.log(`Progress: ${i}/${allUsers.length}`);
      }

      console.log("✅ Finished updating all users (no Excel generated).");
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = processUser;
