const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// ✅ Models
const connectDB = require("../config/db");
const LedgerRow = require("../models/LedgerRow");
const User = require("../models/User");
const DailyUserLp = require("../models/DailyUserLp"); // Make sure model path is correct

async function generateDailyRewardsReport() {
  await connectDB();

  // --- 📅 CLI date argument or default to yesterday ---
  const arg = process.argv.find(a => a.startsWith("--date="));
  const inputDate = arg ? arg.split("=")[1] : null;

  const targetDate = inputDate ? new Date(inputDate) : new Date();
  if (!inputDate) targetDate.setUTCDate(targetDate.getUTCDate() - 1);

  const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0));
  const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate() + 1, 0, 0, 0));

  // LP date = one day before
  const lpDate = new Date(startOfDay);
  lpDate.setUTCDate(lpDate.getUTCDate() - 1);
  const lpStart = new Date(Date.UTC(lpDate.getUTCFullYear(), lpDate.getUTCMonth(), lpDate.getUTCDate(), 0, 0, 0));
  const lpEnd = new Date(Date.UTC(lpDate.getUTCFullYear(), lpDate.getUTCMonth(), lpDate.getUTCDate() + 1, 0, 0, 0));

  console.log(`📅 Generating Daily Rewards Report for ${startOfDay.toISOString().slice(0, 10)}`);
  console.log(`🕒 Ledger Range: ${startOfDay.toISOString()} → ${endOfDay.toISOString()}`);
  console.log(`💧 LP Range (previous day): ${lpStart.toISOString()} → ${lpEnd.toISOString()}`);

  const eventTypes = [
    "DAILY_REWARDS_LP",
    "DAILY_REWARDS_AIRDROP",
    "DAILY_REWARDS_BOOST"
  ];

  // --- 🔍 Fetch ledger rows for target date ---
  const rows = await LedgerRow.find({
    eventType: { $in: eventTypes },
    ts: { $gte: startOfDay, $lt: endOfDay },
  });

  console.log(`📊 Found ${rows.length} reward entries.`);

  // --- 📦 Group rewards by user ---
  const grouped = {};
  for (const row of rows) {
    const userId = row.userId?.toString();
    if (!grouped[userId]) {
      grouped[userId] = { lp: 0, airdrop: 0, boost: 0, total: 0 };
    }
    const amt = parseFloat(row.amount || 0);
    if (row.eventType === "DAILY_REWARDS_LP") grouped[userId].lp += amt;
    else if (row.eventType === "DAILY_REWARDS_AIRDROP") grouped[userId].airdrop += amt;
    else if (row.eventType === "DAILY_REWARDS_BOOST") grouped[userId].boost += amt;
    grouped[userId].total += amt;
  }

  const userIds = Object.keys(grouped);

  // --- 👥 Fetch user details ---
  const users = await User.find({ _id: { $in: userIds } }).select("username uhid");
  const userMap = {};
  users.forEach(u => (userMap[u._id.toString()] = u));

  // --- 💧 Fetch LP values from previous day ---
  const dailyLps = await DailyUserLp.find({
    date: { $gte: lpStart, $lt: lpEnd },
    userId: { $in: userIds },
  }).select("userId lp");

  const lpMap = {};
  dailyLps.forEach(item => {
    lpMap[item.userId.toString()] = parseFloat(item.lp || 0);
  });

  console.log(`💧 Fetched LP data for ${dailyLps.length} users.`);

  // --- 📘 Create Excel workbook ---
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Daily Rewards Report");

  sheet.columns = [
    { header: "Username", key: "username", width: 25 },
    { header: "UHID", key: "uhid", width: 20 },
    { header: "LP (Prev Day)", key: "lpValue", width: 18 },
    { header: "LP Reward", key: "lp", width: 15 },
    { header: "Airdrop Reward", key: "airdrop", width: 15 },
    { header: "Boost Reward", key: "boost", width: 15 },
    { header: "Total Reward", key: "total", width: 15 },
  ];

  for (const [userId, data] of Object.entries(grouped)) {
    const u = userMap[userId] || {};
    sheet.addRow({
      username: u.username || "Unknown",
      uhid: u.uhid || "-",
      lpValue: lpMap[userId] || 0,
      lp: data.lp,
      airdrop: data.airdrop,
      boost: data.boost,
      total: data.total,
    });
  }

  // --- 📊 Add totals row ---
  const totalLp = Object.values(lpMap).reduce((a, b) => a + b, 0);
  const totalReward = Object.values(grouped).reduce((a, b) => a + b.total, 0);
  sheet.addRow({});
  sheet.addRow({
    username: "TOTAL",
    lpValue: totalLp,
    total: totalReward,
  });

  // --- 💾 Save Excel ---
  const reportDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

  const fileDate = startOfDay.toISOString().slice(0, 10);
  const filePath = path.join(reportDir, `daily_rewards_${fileDate}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  console.log(`✅ Report generated successfully at: ${filePath}`);
  process.exit(0);
}

generateDailyRewardsReport().catch(err => {
  console.error("❌ Error generating report:", err);
  process.exit(1);
});
