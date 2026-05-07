"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const ExcelJS = require("exceljs");
const mongoose = require("mongoose");
const connectDB = require("../../config/db");

// Models
const DailyUserLp = require("../../models/DailyUserLp");
const Ledger = require("../../models/Ledger");
const LpReward = require("../../models/LpReward");
const User = require("../../models/User");
const ChainDeposit = require("../../models/ChainDeposit");
const ChainWithdrawal = require("../../models/ChainWithdrawal");

/* =====================================================
   HELPERS
===================================================== */
function getTodayRangeUTC() {
  const now = new Date();
  return {
    tstart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)),
    tend: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
  };
}

function getYesterdayRangeUTC() {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() -1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()- 1, 23, 59, 59, 999)),
  };
}

const toNumber = (val, decimals = 8) => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(decimals));
};

/* =====================================================
   MAIN
===================================================== */
async function generateYesterdayLpReport() {
  const { start, end } = getYesterdayRangeUTC();
   const { tstart, tend } = getTodayRangeUTC();
  getTodayRangeUTC
  

  /* =====================================================
     STEP 1: DAILY LP (YESTERDAY)
  ===================================================== */
  const dailyLpRows = await DailyUserLp.find({
    date: { $gte: start, $lte: end },
  }).lean();

  const userMap = new Map();

  for (const row of dailyLpRows) {
    userMap.set(row.userId.toString(), {
      userId: row.userId,
      username: row.username || "",
      uhid: row.uhid || "",
      lpYesterday: toNumber(row.lp),
      lpRewardsYesterday: 0,
      autopositionting: 0,
      currentLp: 0,
      onChainDeposits: 0,
      onChainWithdrawals: 0,
    });
  }

  const userIds = Array.from(userMap.values()).map((u) => u.userId);

  /* =====================================================
     STEP 2: LP REWARDS (YESTERDAY, createdAt)
  ===================================================== */
const lpRewardsAgg = await LpReward.aggregate([
  {
    $match: {
      createdAt: { $gte: tstart, $lte: tend },
    },
  },
  {
    $sort: { createdAt: -1 }, // ensure latest first
  },
  {
    $group: {
      _id: "$userId",
      total: {
        $sum: {
          $cond: [
            { $eq: [{ $type: "$amount" }, "decimal"] },
            { $toDouble: "$amount" },
            "$amount",
          ],
        },
      },
      rate: { $first: "$rate" }, // ✅ ACTUAL STORED RATE
    },
  },
]);


for (const r of lpRewardsAgg) {
  const key = r._id.toString();
  const rate = toNumber(r.rate); // Decimal128 → Number

  if (!userMap.has(key)) {
    userMap.set(key, {
      userId: r._id,
      username: "",
      uhid: "",
      lpYesterday: 0,
      lpRewardsYesterday: toNumber(r.total),
      autopositionting: 0,
      currentLp: 0,
      onChainDeposits: 0,
      onChainWithdrawals: 0,
      lpRate: rate,
    });
    userIds.push(r._id);
  } else {
    userMap.get(key).lpRewardsYesterday = toNumber(r.total);
    userMap.get(key).lpRate = rate;
  }
}

  /* =====================================================
     STEP 3: ON-CHAIN DEPOSITS (LIFETIME)
  ===================================================== */
  const depositsAgg = await ChainDeposit.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: "$userId",
        total: { $sum: { $toDouble: "$amountXRP" } },
      },
    },
  ]);

  const depositMap = Object.fromEntries(
    depositsAgg.map((d) => [d._id.toString(), toNumber(d.total)])
  );

  /* =====================================================
     STEP 4: ON-CHAIN WITHDRAWALS (LIFETIME, SUCCESS)
  ===================================================== */
const withdrawalsAgg = await ChainWithdrawal.aggregate([
  {
    $match: {
      userId: { $in: userIds },
      $or: [
        { status: "SUCCESS" },
        { status: { $exists: false } }, // legacy rows
      ],
    },
  },
  {
    $group: {
      _id: "$userId",
      total: {
        $sum: {
          $cond: [
            { $gt: ["$amountXRP", null] },
            {
              $cond: [
                { $eq: [{ $type: "$amountXRP" }, "decimal"] },
                { $toDouble: "$amountXRP" },
                "$amountXRP",
              ],
            },
            {
              $cond: [
                { $eq: [{ $type: "$amount" }, "decimal"] },
                { $toDouble: "$amount" },
                "$amount",
              ],
            },
          ],
        },
      },
    },
  },
]);


const withdrawalMap = Object.fromEntries(
  withdrawalsAgg.map((w) => [w._id.toString(), toNumber(w.total)])
);

  /* =====================================================
     STEP 5: LEDGER (AUTOPOSITION + CURRENT LP)
  ===================================================== */
  const ledgers = await Ledger.find(
    { userId: { $in: userIds } },
    {
      userId: 1,
      "wallets.autopositionting": 1,
      "wallets.lp": 1,
    }
  ).lean();

  for (const l of ledgers) {
    const key = l.userId.toString();
    if (userMap.has(key)) {
      userMap.get(key).autopositionting = toNumber(l.wallets?.autopositionting);
      userMap.get(key).currentLp = toNumber(l.wallets?.lp);
    }
  }

  /* =====================================================
     STEP 6: FILL USER INFO
  ===================================================== */
  const missingUsers = Array.from(userMap.values()).filter(
    (u) => !u.username || !u.uhid
  );

  if (missingUsers.length) {
    const users = await User.find(
      { _id: { $in: missingUsers.map((u) => u.userId) } },
      { username: 1, uhid: 1 }
    ).lean();

    for (const u of users) {
      const key = u._id.toString();
      if (userMap.has(key)) {
        userMap.get(key).username = u.username || "";
        userMap.get(key).uhid = u.uhid || "";
      }
    }
  }

  /* =====================================================
     STEP 7: APPLY ON-CHAIN TOTALS
  ===================================================== */
  for (const u of userMap.values()) {
    const id = u.userId.toString();
    u.onChainDeposits = toNumber(depositMap[id]);
    u.onChainWithdrawals = toNumber(withdrawalMap[id]);
  }

  /* =====================================================
     STEP 8: EXCEL EXPORT
  ===================================================== */
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Yesterday LP Report");

  sheet.columns = [
    { header: "User ID", key: "userId", width: 28 },
    { header: "Username", key: "username", width: 22 },
    { header: "UHID", key: "uhid", width: 20 },
    { header: "LP Yesterday", key: "lpYesterday", width: 16 },
    { header: "LP Rewards", key: "lpRewardsYesterday", width: 22 },
    { header: "LP Rate (%)", key: "lpRate", width: 14 }, // ✅
    { header: "Autopositionting", key: "autopositionting", width: 20 },
    { header: "Current LP", key: "currentLp", width: 16 },
    { header: "OnChain Deposits (Total)", key: "onChainDeposits", width: 22 },
    { header: "OnChain Withdrawals (Total)", key: "onChainWithdrawals", width: 26 },
  ];

  let totals = {
    lpYesterday: 0,
    lpRewardsYesterday: 0,
    autopositionting: 0,
    currentLp: 0,
    onChainDeposits: 0,
    onChainWithdrawals: 0,
  };

  for (const r of userMap.values()) {
    sheet.addRow({
      userId: r.userId.toString(),
      username: r.username,
      uhid: r.uhid,
      lpYesterday: r.lpYesterday,
      lpRewardsYesterday: r.lpRewardsYesterday,
      lpRate:r.lpRate,
      autopositionting: r.autopositionting,
      currentLp: r.currentLp,
      onChainDeposits: r.onChainDeposits,
      onChainWithdrawals: r.onChainWithdrawals,
    });

    Object.keys(totals).forEach((k) => (totals[k] += r[k]));
  }

  sheet.addRow({});
  const totalRow = sheet.addRow({
    username: "TOTAL",
    ...totals,
  });
  totalRow.font = { bold: true };

  const reportsDir = path.join(__dirname, "..", "..", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  const filePath = path.join(
    reportsDir,
    `yesterday_lp_report_${tstart.toISOString().slice(0, 10)}.xlsx`
  );

  await workbook.xlsx.writeFile(filePath);
  
}

/* =====================================================
   RUNNER
===================================================== */
(async () => {
  try {
    await connectDB();
    await generateYesterdayLpReport();
    await mongoose.disconnect();
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Report failed:", err);
    process.exit(1);
  }
})();
