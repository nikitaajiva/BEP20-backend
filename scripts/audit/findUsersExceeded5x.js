"use strict";

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const ExcelJS = require("exceljs");
const connectDB = require("../../config/db");
const Ledger = require("../../models/Ledger");
const User = require("../../models/User");

async function generate5xExcelReport() {
  await connectDB();
  console.log("📊 Generating 5× limit Excel report...");

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, "..", "..", "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Find users where used >= cap
  const ledgers = await Ledger.find({
    "limits.fiveXLimit.cap": { $gt: 0 },
    $expr: {
      $gte: ["$limits.fiveXLimit.used", "$limits.fiveXLimit.cap"],
    },
  }).lean();

  if (!ledgers.length) {
    console.log("✅ No users exceeded or reached 5× cap");
    return;
  }

  const userIds = ledgers.map(l => l.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select("_id username uhid")
    .lean();

  const userMap = new Map(users.map(u => [String(u._id), u]));

  // Create workbook & sheet
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("5X Limit Audit");

  sheet.columns = [
    { header: "Username", key: "username", width: 20 },
    { header: "UHID", key: "uhid", width: 20 },
    { header: "User ID", key: "userId", width: 28 },
    { header: "5X Cap", key: "cap", width: 15 },
    { header: "5X Used", key: "used", width: 15 },
    { header: "Exceeded By", key: "exceededBy", width: 15 },
    { header: "LP Wallet", key: "lp", width: 15 },
    { header: "ZeroRisk Wallet", key: "zeroRisk", width: 18 },
    { header: "CommunityRewards Wallet", key: "communityRewards", width: 22 },
    { header: "Status", key: "status", width: 12 },
  ];

  let exceededCount = 0;

  for (const ledger of ledgers) {
    const user = userMap.get(String(ledger.userId));

    const cap = Number(ledger.limits?.fiveXLimit?.cap || 0);
    const used = Number(ledger.limits?.fiveXLimit?.used || 0);
    const exceededBy = used - cap;

    const lp = Number(ledger.wallets?.lp || 0);
    const zeroRisk = Number(ledger.wallets?.zeroRisk || 0);
    const communityRewards = Number(ledger.wallets?.communityRewards || 0);

    const status = exceededBy > 0 ? "EXCEEDED" : "REACHED";
    if (exceededBy > 0) exceededCount++;

    sheet.addRow({
      username: user?.username || "N/A",
      uhid: user?.uhid || "",
      userId: String(ledger.userId),
      cap: cap.toFixed(6),
      used: used.toFixed(6),
      exceededBy: exceededBy > 0 ? exceededBy.toFixed(6) : "0.000000",
      lp: lp.toFixed(6),
      zeroRisk: zeroRisk.toFixed(6),
      communityRewards: communityRewards.toFixed(6),
      status,
    });
  }

  // Styling
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = "A1:J1";

  const fileName = `5x_limit_exceeded_report_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  const filePath = path.join(reportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  console.log("========================================");
  console.log(`📄 Excel file created: ${filePath}`);
  console.log(`Total reached/exceeded : ${ledgers.length}`);
  console.log(`Total exceeded (ERROR) : ${exceededCount}`);
  console.log("========================================");

  await mongoose.disconnect();
}

generate5xExcelReport()
  .then(() => {
    console.log("✅ Excel report generation completed");
    process.exit(0);
  })
  .catch(err => {
    console.error("❌ Failed to generate Excel report:", err);
    process.exit(1);
  });
