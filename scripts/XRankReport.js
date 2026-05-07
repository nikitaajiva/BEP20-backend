/**
 * Generate full X-Rank Achievement Report
 * Includes:
 * - Today XBonus
 * - LP Rewards (yesterday)
 * - Boost Rewards (yesterday)
 * - Airdrop Rewards (yesterday)
 * - Community Rewards (yesterday)
 * - Community Booster Rewards (yesterday)
 * - Today XPower Rewards
 * - Sorted by XRank ASC
 *
 * Additionally:
 * - Computes "Total Rewards Today" (sum of all reward columns EXCEPT Total XBonus)
 * - Stores that into EventRewardCredit for the current UTC date
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const moment = require("moment");
const ExcelJS = require("exceljs");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../config/db");

const LedgerRow = require("../models/LedgerRow");
const CascadeReward = require("../models/CascadeReward");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
const User = require("../models/User");
const X1Reward = require("../models/X1Reward");


(async () => {
  try {
    await connectDB();
    

    const Decimal128 = mongoose.Types.Decimal128;

    // -------------------------
    // TODAY + YESTERDAY ranges (UTC)
    // -------------------------
    const todayStart = moment().utc().startOf("day").toDate();
    const todayEnd = moment().utc().endOf("day").toDate();

    const yesterdayStart = moment().utc().subtract(1, "day").startOf("day").toDate();
    const yesterdayEnd = moment().utc().subtract(1, "day").endOf("day").toDate();

    // String form of today's date for EventRewardCredit
    const eventDate = moment().utc().format("YYYY-MM-DD");
    const EVENT_NAME = "MACAU_HK_EVENT";

    // -------------------------
    // XBonus aggregation
    // -------------------------
    const rewardAgg = await X1Reward.aggregate([
      {
        $group: {
          _id: "$userId",
          totalBonus: { $sum: "$amount" },

          todayBonus: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$ts", todayStart] }, { $lte: ["$ts", todayEnd] }] },
                "$amount",
                0,
              ],
            },
          },

          X1Date: { $min: { $cond: [{ $eq: ["$tier", "X1"] }, "$ts", null] } },
          X2Date: { $min: { $cond: [{ $eq: ["$tier", "X2"] }, "$ts", null] } },
          X3Date: { $min: { $cond: [{ $eq: ["$tier", "X3"] }, "$ts", null] } },
          X4Date: { $min: { $cond: [{ $eq: ["$tier", "X4"] }, "$ts", null] } },
          X5Date: { $min: { $cond: [{ $eq: ["$tier", "X5"] }, "$ts", null] } },
        },
      },
    ]);

    if (!rewardAgg.length) {
      
      process.exit(0);
    }

    const merged = [];

    // Process each user
    for (const r of rewardAgg) {
      const user = await User.findById(r._id).lean();
      if (!user) continue;

      // Determine XRANK
      let actualRank = "None";
      if (r.X5Date) actualRank = "X5";
      else if (r.X4Date) actualRank = "X4";
      else if (r.X3Date) actualRank = "X3";
      else if (r.X2Date) actualRank = "X2";
      else if (r.X1Date) actualRank = "X1";

      if (actualRank === "None") continue;

      // ------------------------------
      // LP + BOOST + AIRDROP rewards (yesterday)
      // ------------------------------
      const ledgerRowsYesterday = await LedgerRow.find({
        userId: user._id,
        eventType: [
          "DAILY_REWARDS_LP",
          "DAILY_REWARDS_BOOST",
          "DAILY_REWARDS_AIRDROP",
        ],
        ts: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }).lean();

      let lpAmount = 0;
      let boostAmount = 0;
      let airdropAmount = 0;

      ledgerRowsYesterday.forEach((row) => {
        const amt = parseFloat(row.amount.toString());
        if (row.eventType === "DAILY_REWARDS_LP") lpAmount += amt;
        if (row.eventType === "DAILY_REWARDS_BOOST") boostAmount += amt;
        if (row.eventType === "DAILY_REWARDS_AIRDROP") airdropAmount += amt;
      });

      // ------------------------------
      // Today XPower Rewards
      // ------------------------------
      const xpowerRows = await LedgerRow.find({
        userId: user._id,
        eventType: "XPOWER_REWARDS",
        ts: { $gte: todayStart, $lte: todayEnd },
      }).lean();

      let xpowerAmount = 0;
      xpowerRows.forEach((row) => {
        xpowerAmount += parseFloat(row.amount.toString());
      });

      // ------------------------------
      // Yesterday Community Rewards (Cascade)
      // ------------------------------
      const cascadeRows = await CascadeReward.find({
        userId: user._id,
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      });

      let communityAmount = 0;
      cascadeRows.forEach((c) => {
        communityAmount += parseFloat(c.amount.toString());
      });

      // ------------------------------
      // Yesterday Community Booster Rewards
      // ------------------------------
      const boosterRows = await CommunityBoosterReward.find({
        userId: user._id,
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      });

      let boosterAmount = 0;
      boosterRows.forEach((b) => {
        boosterAmount += parseFloat(b.amount.toString());
      });

      // ------------------------------
      // Compute Total Rewards Today (for event)
      // Sum of all reward columns EXCEPT total XBonus
      // ------------------------------
      const todayBonusNum = parseFloat(r.todayBonus?.toString() || "0");
      const totalRewardsToday =
        todayBonusNum +
        lpAmount +
        boostAmount +
        airdropAmount +
        xpowerAmount +
        communityAmount +
        boosterAmount;

      const lpAmountStr = lpAmount.toFixed(6);
      const boostAmountStr = boostAmount.toFixed(6);
      const airdropAmountStr = airdropAmount.toFixed(6);
      const xpowerAmountStr = xpowerAmount.toFixed(6);
      const communityAmountStr = communityAmount.toFixed(6);
      const boosterAmountStr = boosterAmount.toFixed(6);
      const totalRewardsTodayStr = totalRewardsToday.toFixed(6);

      // ------------------------------
      // Store event credit for current date
      // ------------------------------
      // NOTE: This will overwrite credited/remaining for this date/event
      // but keep redeemed if already set (we only set redeemed on insert).

      // Accumulate for Excel
      merged.push({
        user: { ...user, xRank: actualRank },
        data: r,
        lpAmount: lpAmountStr,
        boostAmount: boostAmountStr,
        airdropAmount: airdropAmountStr,
        xpowerAmount: xpowerAmountStr,
        communityAmount: communityAmountStr,
        boosterAmount: boosterAmountStr,
        totalRewardsToday: totalRewardsTodayStr,
      });
    }

    // ------------------------------
    // Sort by XRANK ASC
    // ------------------------------
    const rankOrder = { X1: 1, X2: 2, X3: 3, X4: 4, X5: 5 };
    merged.sort((a, b) => rankOrder[a.user.xRank] - rankOrder[b.user.xRank]);

    // ------------------------------
    // Excel Sheet
    // ------------------------------
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("X-Rank Achievements");

    sheet.columns = [
      { header: "Username", key: "username", width: 20 },
      { header: "UHID", key: "uhid", width: 15 },
      { header: "XRP Address", key: "xrpAddress", width: 40 },
      { header: "X Rank", key: "xRank", width: 10 },

      { header: "Total XBonus", key: "totalBonus", width: 20 },
      { header: "Today XBonus", key: "todayBonus", width: 20 },

      { header: "LP Rewards", key: "lpAmount", width: 18 },
      { header: "Boost Rewards", key: "boostAmount", width: 20 },
      { header: "Airdrop Rewards", key: "airdropAmount", width: 22 },
      { header: "XPower Rewards", key: "xpowerAmount", width: 20 },
      { header: "Community Rewards", key: "communityAmount", width: 22 },
      { header: "Community Booster", key: "boosterAmount", width: 22 },

      { header: "Total Rewards Today", key: "totalRewardsToday", width: 22 }, // ✅ NEW

      { header: "X1 Achieved", key: "X1Date", width: 20 },
      { header: "X2 Achieved", key: "X2Date", width: 20 },
      { header: "X3 Achieved", key: "X3Date", width: 20 },
      { header: "X4 Achieved", key: "X4Date", width: 20 },
      { header: "X5 Achieved", key: "X5Date", width: 20 },
    ];

    sheet.getRow(1).font = { bold: true };

    const fmt = (d) => (d ? moment.utc(d).format("YYYY-MM-DD HH:mm:ss") : "");

    for (const row of merged) {
      sheet.addRow({
        username: row.user.username || row.user.name || "",
        uhid: row.user.uhid,
        xrpAddress: row.user.xrpAddress,
        xRank: row.user.xRank,

        totalBonus: parseFloat(row.data.totalBonus.toString()).toFixed(6),
        todayBonus: parseFloat(row.data.todayBonus.toString()).toFixed(6),

        lpAmount: row.lpAmount,
        boostAmount: row.boostAmount,
        airdropAmount: row.airdropAmount,
        xpowerAmount: row.xpowerAmount,
        communityAmount: row.communityAmount,
        boosterAmount: row.boosterAmount,

        totalRewardsToday: row.totalRewardsToday,

        X1Date: fmt(row.data.X1Date),
        X2Date: fmt(row.data.X2Date),
        X3Date: fmt(row.data.X3Date),
        X4Date: fmt(row.data.X4Date),
        X5Date: fmt(row.data.X5Date),
      });
    }

    // ------------------------------
    // SAVE FILE
    // ------------------------------
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const fileName = `XRankReport_${moment.utc().format(
      "YYYY-MM-DD_HH-mm"
    )}.xlsx`;
    const filePath = path.join(reportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);

    
    

    process.exit(0);
  } catch (err) {
    console.error("❌ Error generating report:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
