const mongoose = require("mongoose");
require("dotenv").config();
const ExcelJS = require("exceljs");

const LpReward = require("../models/LpReward");
const AirdropReward = require("../models/AirdropReward");
const BoostReward = require("../models/BoostReward");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const connectDB = require("../config/db");

/* =========================
   Helpers
========================= */
const toNum = (v) => (v ? parseFloat(v.toString()) : 0);
const toD128 = (n) =>
  mongoose.Types.Decimal128.fromString(Number(n).toString());

async function applyRewardsWithReport() {
  await connectDB();
  

  const start = new Date(Date.UTC(2025, 11, 12, 0, 0, 0));
  const end = new Date(Date.UTC(2025, 11, 13, 0, 0, 0));
  const creditTs = new Date(Date.UTC(2025, 11, 12, 23, 48, 0));

  const dateFilter = {
    $or: [
      { ts: { $gte: start, $lt: end } },
      { createdAt: { $gte: start, $lt: end } },
    ],
  };

  /* =========================
     1️⃣ LOAD REWARDS
  ========================= */
  const lp = await LpReward.find(dateFilter);
  const boost = await BoostReward.find(dateFilter);
  const air = await AirdropReward.find(dateFilter);

  console.log(
    `📦 Rewards → LP:${lp.length} BOOST:${boost.length} AIRDROP:${air.length}`
  );

  /* =========================
     2️⃣ BUILD EXPECTED TOTALS
  ========================= */
  const expected = {}; // userId_eventType

  const add = (r, eventType, limitKey) => {
    const key = `${r.userId}_${eventType}`;
    if (!expected[key]) {
      expected[key] = {
        userId: r.userId,
        eventType,
        limitKey,
        rewardTotal: 0,
        narrative: r.narrative || "Reward credit 12-12",
      };
    }
    expected[key].rewardTotal += toNum(r.amount);
  };

  lp.forEach((r) => add(r, "DAILY_REWARDS_LP", "lpLimit"));
  boost.forEach((r) => add(r, "DAILY_REWARDS_BOOST", "boostLimit"));
  air.forEach((r) => add(r, "DAILY_REWARDS_AIRDROP", "airdropLimit"));

  /* =========================
     3️⃣ EXCEL SETUP
  ========================= */
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("12-12 Reward Credit");

  sheet.columns = [
    { header: "User ID", key: "userId", width: 28 },
    { header: "Reward Type", key: "eventType", width: 22 },
    { header: "Amount Credited", key: "amount", width: 18 },
    { header: "Wallet Before", key: "walletBefore", width: 18 },
    { header: "Wallet After", key: "walletAfter", width: 18 },
    { header: "Limit Used Before", key: "limitBefore", width: 18 },
    { header: "Limit Used After", key: "limitAfter", width: 18 },
    { header: "LedgerRow Action", key: "ledgerAction", width: 22 },
  ];

  /* =========================
     4️⃣ APPLY LOGIC
  ========================= */
  let processed = 0;

  for (const key of Object.keys(expected)) {
    const exp = expected[key];
    const amount = Number(exp.rewardTotal.toFixed(8));
    if (amount <= 0) continue;

    const ledger = await Ledger.findOne({ userId: exp.userId });
    if (!ledger) continue;

    // ---- Wallet ----
    const walletBefore = toNum(ledger.wallets?.communityRewards);
    ledger.wallets.communityRewards = toD128(walletBefore + amount);

    ledger.totalRewardsCredited = toD128(
      toNum(ledger.totalRewardsCredited) + amount
    );

    // ---- Limits.used (CAP SAFE) ----
    ledger.limits = ledger.limits || {};
    ledger.limits[exp.limitKey] = ledger.limits[exp.limitKey] || {};

    const limitBefore = toNum(ledger.limits[exp.limitKey].used);
    ledger.limits[exp.limitKey].used = toD128(limitBefore + amount);

    await ledger.save();

    // ---- LedgerRow ----
    let ledgerAction = "CREATED";
    const row = await LedgerRow.findOne({
      userId: exp.userId,
      eventType: exp.eventType,
      walletTo: "COMMUNITY_REWARDS",
      ts: { $gte: start, $lt: end },
    });

    if (!row) {
      await LedgerRow.create({
        userId: exp.userId,
        eventType: exp.eventType,
        walletTo: "COMMUNITY_REWARDS",
        amount: toD128(amount),
        narrative: exp.narrative,
        ts: creditTs,
      });
    } else {
      row.amount = toD128(amount);
      await row.save();
      ledgerAction = "UPDATED";
    }

    // ---- Excel Row ----
    sheet.addRow({
      userId: exp.userId.toString(),
      eventType: exp.eventType,
      amount,
      walletBefore,
      walletAfter: walletBefore + amount,
      limitBefore,
      limitAfter: limitBefore + amount,
      ledgerAction,
    });

    processed++;
  }

  /* =========================
     5️⃣ SAVE REPORT
  ========================= */
  const fileName = `Reward_Credit_Report_2025-12-12.xlsx`;
  await workbook.xlsx.writeFile(fileName);

  console.log(`
================ FINAL SUMMARY =================
✅ Users Processed : ${processed}
📊 Excel Report   : ${fileName}
📅 Date           : 2025-12-12
==============================================
`);

  await mongoose.disconnect();
  
}

applyRewardsWithReport().catch(async (err) => {
  console.error("❌ Script failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
