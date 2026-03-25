// scripts/boostReport.js
const mongoose = require("mongoose");
const path = require("path");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const User = require("../models/User");
const Level = require("../models/Level");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");

/* ----------------------------- HELPERS ----------------------------- */
function toISO(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

function toAmountNumber(v) {
  if (!v) return 0;
  return typeof v === "number" ? v : Number(v);
}

/* ----------------------- BONUS SCHEDULE ------------------------ */
function getSponsorBonusPctUTCAt(sponsorFirstLpDate, asOfDate) {
  if (!sponsorFirstLpDate) return 0;

  const ts = Date.parse(sponsorFirstLpDate);
  const asOfTs = asOfDate ? Date.parse(asOfDate) : Date.now();
  if (!Number.isFinite(ts) || !Number.isFinite(asOfTs)) return 0;

  const cutoffTs = Date.parse("2025-08-08T00:00:00Z");
  const hours = (asOfTs - ts) / 36e5;

  if (ts > cutoffTs) {
    if (hours <= 8 * 24) return 0.5;
    if (hours <= 15 * 24) return 0.3;
    if (hours <= 22 * 24) return 0.2;
    if (hours <= 30 * 24) return 0.1;
    return 0;
  }

  if (hours <= 2 * 24) return 0.5;
  if (hours <= 9 * 24) return 0.3;
  if (hours <= 16 * 24) return 0.2;
  if (hours <= 23 * 24) return 0.1;
  if (hours <= 30 * 24) return 0.05;
  return 0;
}

function calculateBonus(startDate, currentDate, amount) {
  const pctFraction = getSponsorBonusPctUTCAt(startDate, currentDate);
  const amt = toAmountNumber(amount);
  return { pct: pctFraction * 100, bonus: amt * pctFraction };
}

/* ------------------------ PARENT (USER) EXCEL --------------------- */
async function exportUserExcel(userId, filename) {
  const events = await LedgerRow.find({
    userId,
    $or: [
      { eventType: "LP_DEPOSIT_FROM_XAMAN" },
      { eventType: "AUTOPOSITIONING" },
      { eventType: "WITHDRAWAL", walletFrom: "ZERO_RISK" },
      { narrative: { $regex: "autoposition(ing)?", $options: "i" } },
    ],
  })
    .sort({ ts: 1 })
    .lean();

  if (!events.length) {
    console.log(`⚠️  No ledger rows found for userId=${userId}`);
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("User Report");

  ws.columns = [
    { header: "Date (UTC)", key: "date", width: 25 },
    { header: "UHID", key: "uhid", width: 20 },
    { header: "Username", key: "username", width: 20 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Activity", key: "activity", width: 25 },
    { header: "Cumulative LP", key: "LP", width: 20 },
  ];

  let cumulativeLP = 0;
  const lpLimitRows = [];
 // --- Detect first LP deposit date ---
  const firstLpEvent = events.find(
    (r) => r.eventType === "LP_DEPOSIT_FROM_XAMAN"
  );

  let firstLpDepositDate = null;
  let lpDepositEndDate = null;

 if (firstLpEvent) {
  firstLpDepositDate = new Date(firstLpEvent.ts || firstLpEvent.createdAt);

  lpDepositEndDate = new Date(firstLpDepositDate);
  lpDepositEndDate.setUTCDate(lpDepositEndDate.getUTCDate() + 29);

  // force end of day 23:59:59 UTC
  lpDepositEndDate.setUTCHours(23, 59, 59, 999);

  console.log("🚀 First LP Deposit Date:", firstLpDepositDate.toISOString());
  console.log("⏳ LP Deposit End Date:", lpDepositEndDate.toISOString());
}

// --- Main Loop ---
for (const r of events) {
  const date = toISO(r.ts) || toISO(r.createdAt);
  const amount = toAmountNumber(r.amount);
  let activity = "";

  if (r.eventType === "LP_DEPOSIT_FROM_XAMAN") {
    activity = "LP_DEPOSIT_FROM_XAMAN";
    if (!lpDepositEndDate || new Date(date) <= lpDepositEndDate) {
      cumulativeLP += amount; // only within 30-day window
    }
  } else if (r.eventType === "WITHDRAWAL" && r.walletFrom === "ZERO_RISK") {
    activity = "CLAIMED";
    cumulativeLP -= amount; // immediate decrease
  } else if (r.eventType === "AUTOPOSITIONING") {
    activity = "AUTOPOSITIONING";
    if (!lpDepositEndDate || new Date(date) <= lpDepositEndDate) {
      cumulativeLP += amount; // only within 30-day window
    }
  }

  // Add row to worksheet
  const row = ws.addRow({
    date,
    uhid: r.userId.toString(),
    username: "",
    amount,
    activity,
    LP: cumulativeLP,
    lpLimit: cumulativeLP, // set LP limit directly
  });

  // --- Update user ledger with final cumulativeLP ---
await Ledger.updateOne(
  {userId },
  { $set: { "limits.boostLimit.cap": cumulativeLP } }
);
//console.log(`✅ Updated user ${userId} wallets.boost to ${cumulativeLP}`);

  // Push LP limit for this date after adding row
  lpLimitRows.push({ date, cumulativeLP });
}



  if (filename) {
    await workbook.xlsx.writeFile(filename);
    console.log(`✅ User report written: ${filename}`);
  }

return {
  firstDate: toISO(events[0].ts) || toISO(events[0].createdAt),
  lpLimitRows,
  lpDepositEndDate, // ✅ add this
};
}

function toDayKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}


/* -------------------------- CHILDREN EXCEL --------------------------- */
async function exportChildrenExcel(parentUhid, filename, startDate, endDate, lpLimitRows = []) {
  const result = await Level.aggregate([
    { $match: { parent: parentUhid, level: 1 } },
    { $group: { _id: "$parent", children: { $push: "$child" } } },
  ]);
  // console.log(lpLimitRows,"Rows to show");

  if (!result.length || !result[0].children.length) {
    console.log("⚠️  No children found for parent:", parentUhid);
    return { closingBalance: 0, childrenCount: 0, rowsCount: 0 };
  }

  const childrenUhids = result[0].children;
  const users = await User.find({ uhid: { $in: childrenUhids } })
    .select("_id uhid username")
    .lean();

  const allEvents = [];
  for (const u of users) {
    const events = await LedgerRow.find({
      userId: u._id,
      $or: [
        { eventType: "LP_DEPOSIT_FROM_XAMAN" },
        { eventType: "AUTOPOSITIONING" },
        { eventType: "WITHDRAWAL", walletFrom: "ZERO_RISK" },
        { narrative: { $regex: "autoposition(ing)?", $options: "i" } },
      ],
    }).lean();

    allEvents.push(...events.map((e) => ({ ...e, u })));
  }

  allEvents.sort((a, b) => new Date(a.ts || a.createdAt) - new Date(b.ts || b.createdAt));

  // Filter events after startDate
  const afterStart = startDate
    ? allEvents.filter((r) => new Date(r.ts || r.createdAt) >= new Date(startDate))
    : allEvents;


  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Children Report");

  ws.columns = [
    { header: "Date (UTC)", key: "date", width: 25 },
    { header: "UHID", key: "uhid", width: 20 },
    { header: "Username", key: "username", width: 20 },
    { header: "Activity", key: "activity", width: 25 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Percentage Applied", key: "pct", width: 15 },
    { header: "Bonus", key: "bonus", width: 15 },
    { header: "Closing Balance", key: "closingBalance", width: 20 },
    { header: "LP Limit", key: "lpLimit", width: 20 },
  ];
const lpMap = new Map(lpLimitRows.map(r => [r.date, r.cumulativeLP]));


  let closingBalance = 0;
  const positions = [];

  for (const r of afterStart) {
    const date = toISO(r.ts) || toISO(r.createdAt);
    const amount = toAmountNumber(r.amount);
    let activity = "";

    if (r.eventType === "LP_DEPOSIT_FROM_XAMAN") activity = "LP_DEPOSIT_FROM_XAMAN";
    else if (r.eventType === "AUTOPOSITIONING") activity = "AUTOPOSITIONING";
    else if (r.eventType === "WITHDRAWAL" && r.walletFrom === "ZERO_RISK") activity = "ZERO_RISK";
const lpMap = new Map(lpLimitRows.map(r => [toDayKey(r.date), r.cumulativeLP]));
const lpLimitRow = lpMap.get(toDayKey(date)) ?? 0;

  if ((activity === "LP_DEPOSIT_FROM_XAMAN" || activity === "AUTOPOSITIONING") &&
    new Date(date) <= new Date(endDate)) {
      const { pct, bonus } = calculateBonus(startDate, date, amount);

      // Cap bonus by remaining LP limit
      const remainingLimit = lpLimitRow - closingBalance;
      const appliedBonus = bonus > remainingLimit ? remainingLimit : bonus;

      positions.push({ userId: r.u._id.toString(), remainingAmount: amount, pct });
      closingBalance += appliedBonus;

      ws.addRow({
        date,
        uhid: r.u.uhid,
        username: r.u.username || "",
        activity,
        amount,
        pct: `${pct}%`,
        bonus: appliedBonus,
        closingBalance,
        lpLimit: lpLimitRow,
      });
    // console.log("Date:", date, "Activity:", activity, "LP Limit:", lpLimitRow, "Closing Balance:", closingBalance);

    } else if (activity === "ZERO_RISK") {
      let withdrawLeft = amount;
      for (const pos of positions) {
        if (pos.userId !== r.u._id.toString()) continue;
        if (withdrawLeft <= 0) break;

        const take = Math.min(pos.remainingAmount, withdrawLeft);
        const deduction = (take * pos.pct) / 100;

        pos.remainingAmount -= take;
        withdrawLeft -= take;
        closingBalance -= deduction;  
         const roundedClosing = Number(closingBalance.toFixed(6));
        ws.addRow({
          date,
          uhid: r.u.uhid,
          username: r.u.username || "",
          activity,
          amount: take,
          pct: `${pos.pct}%`,
          bonus: -deduction,
          closingBalance,
          lpLimit: lpLimitRow,
        });
      await Ledger.updateOne(
        { uhid:parentUhid },
        { $set: { "wallets.boost": roundedClosing } }
      );


      }
    }
  }

  if (filename) {
    await workbook.xlsx.writeFile(filename);
    console.log(`✅ Children report written: ${filename}`);
  }

  return { closingBalance, childrenCount: users.length, rowsCount: ws.rowCount };
}


/* ------------------------------- MAIN ------------------------------ */
(async () => {
  await connectDB();

  const uhid = process.argv[2];

  if (!uhid) {
    console.error("❌ Please provide a UHID argument to generate reports.");
    process.exit(1);
  }

  const user = await User.findOne({ uhid }).select("_id uhid username firstLpDepositTs").lean();
  if (!user) {
    console.error("❌ No user found for uhid:", uhid);
    process.exit(1);
  }

  // Generate user report
  const userExcel = `user_${uhid}.xlsx`;
  const userExport = await exportUserExcel(user._id.toString(), userExcel);

const firstDate = userExport?.firstDate || user.firstLpDepositTs || null;
const lpDepositEndDate = userExport?.lpDepositEndDate || null; // now this will not be null
console.log("User LP Start Date:", firstDate);
console.log("LP Deposit End Date:", lpDepositEndDate);


  // Pass both dates and LP limit rows to children sheet
await exportChildrenExcel(
  uhid,
  `children_${uhid}.xlsx`,
  firstDate,           // Start date
  lpDepositEndDate,    // End date (30-day LP limit period)
  userExport?.lpLimitRows || []
);
  await mongoose.connection.close();
})();


