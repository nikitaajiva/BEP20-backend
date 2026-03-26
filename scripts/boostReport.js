// scripts/boostReport.js
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");

const User = require("../models/User");
const Level = require("../models/Level");
const LedgerRow = require("../models/LedgerRow");
const Ledger = require("../models/Ledger"); 

/* ----------------------------- FILE OUTPUT ----------------------------- */
const REPORTS_DIR = path.join(process.cwd(), "reports");
function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}
function writeCsv(filename, rows) {
  ensureReportsDir();
  const header = "uhid,closingBalance\n";
  const lines = rows.map((r) => `${r.uhid},${r.closingBalance}`).join("\n");
  const out = header + lines;
  const outPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outPath, out);
  console.log(`\n✅ Wrote summary: ${outPath}`);
}

/* ----------------------------- HELPERS --------------------------------- */
function toISO(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}
function toAmountNumber(v) {
  if (!v) return 0;
  return typeof v === "number" ? v : Number(v);
}

/* ----------------------- BONUS SCHEDULE ---------------------------- */
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

/* ------------------- SPONSOR START DATE ------------------- */
async function getSponsorStartDate(userId) {
  const first = await LedgerRow.find({
    userId,
    $or: [
      { eventType: "LP_DEPOSIT_FROM_XAMAN" },
      { eventType: "WITHDRAWAL", walletFrom: "ZERO_RISK" },
      { narrative: { $regex: "autoposition(ing)?", $options: "i" } },
    ],
  })
    .select({ ts: 1, createdAt: 1 })
    .sort({ ts: 1 })
    .limit(1)
    .lean();
  if (!first || !first.length) return null;
  return toISO(first[0].ts) || toISO(first[0].createdAt);
}

/* ------------------- CHILDREN CLOSING BALANCE ------------------- */
async function computeChildrenClosingBalance(parentUhid, startDate) {
  const result = await Level.aggregate([
    { $match: { parent: parentUhid, level: 1 } },
    { $group: { _id: "$parent", children: { $push: "$child" } } },
  ]);
  if (!result.length || !result[0].children.length) {
    return { closingBalance: 0 };
  }
  const childrenUhids = result[0].children;
  const users = await User.find({ uhid: { $in: childrenUhids } })
    .select("_id uhid username")
    .lean();
  let allEvents = [];
  for (const u of users) {
    const events = await LedgerRow.find({
      userId: u._id,
      $or: [
        { eventType: "LP_DEPOSIT_FROM_XAMAN" },
        { eventType: "WITHDRAWAL", walletFrom: "ZERO_RISK" },
        { narrative: { $regex: "autoposition(ing)?", $options: "i" } },
      ],
    })
      .select({
        ts: 1,
        createdAt: 1,
        amount: 1,
        eventType: 1,
        narrative: 1,
        walletFrom: 1,
      })
      .lean();
    allEvents.push(...events.map((e) => ({ ...e, u })));
  }
  allEvents.sort(
    (a, b) => new Date(a.ts || a.createdAt) - new Date(b.ts || b.createdAt)
  );
  const afterStart = startDate
    ? allEvents.filter((r) => new Date(r.ts || r.createdAt) >= new Date(startDate))
    : allEvents;
  const firstDepositIndex = afterStart.findIndex(
    (r) =>
      r.eventType === "LP_DEPOSIT_FROM_XAMAN" ||
      (r.narrative && /autoposition(ing)?/i.test(r.narrative))
  );
  const filteredEvents =
    firstDepositIndex >= 0 ? afterStart.slice(firstDepositIndex) : [];
  let closingBalance = 0;
  const positions = [];
  for (const r of filteredEvents) {
    const date = toISO(r.ts) || toISO(r.createdAt);
    const amount = toAmountNumber(r.amount);
    let activity = "";
    if (r.eventType === "LP_DEPOSIT_FROM_XAMAN") activity = "LP_DEPOSIT_FROM_XAMAN";
    else if (r.eventType === "WITHDRAWAL" && r.walletFrom === "ZERO_RISK")
      activity = "zero_risk";
    else if (r.narrative && /autoposition(ing)?/i.test(r.narrative))
      activity = "autopositioning";
    if (activity === "LP_DEPOSIT_FROM_XAMAN" || activity === "autopositioning") {
      const { pct, bonus } = calculateBonus(startDate, date, amount);
      positions.push({
        userId: r.u._id.toString(),
        remainingAmount: amount,
        pct,
      });
      closingBalance += bonus;
    } else if (activity === "zero_risk") {
      let withdrawLeft = amount;
      for (const pos of positions) {
        if (pos.userId !== r.u._id.toString()) continue;
        if (withdrawLeft <= 0) break;
        const take = Math.min(pos.remainingAmount, withdrawLeft);
        const deduction = (take * pos.pct) / 100;
        pos.remainingAmount -= take;
        withdrawLeft -= take;
        closingBalance -= deduction;
      }
    }
  }
  return { closingBalance };
}

/* ----------------------------- MAIN ----------------------------- */
// (async () => {
//   await connectDB();
//   const parentUhids = await Level.distinct("parent", { level: 1 });
//   const results = [];
//   for (const parentUhid of parentUhids) {
//     const parent = await User.findOne({ uhid: parentUhid }).select("_id uhid firstLpDepositTs").lean();
//     if (!parent) continue;
//     const startDate = parent?.firstLpDepositTs || await getSponsorStartDate(parent._id.toString());
//     const { closingBalance } = await computeChildrenClosingBalance(
//       parent.uhid,
//       startDate
//     );

//     // 👇 progress log for each parent
//     console.log(`Running for parent UHID=${parent.uhid} ... ClosingBalance=${closingBalance}`);

//     results.push({ uhid: parent.uhid, closingBalance });
//       await Ledger.updateOne(
//       { userId: parent._id },
//       { $set: { "wallets.boost": closingBalance } }
//     );
//   }
//   // Write results to CSV
//   writeCsv("boost_summary_all.csv", results);
//   await mongoose.connection.close();
// })();


/* ----------------------------- MAIN ----------------------------- */
(async () => {
  await connectDB();

  // 👇 Get UHID from command line args
  const argUhid = process.argv[2]; // node scripts/boostReport.js <UHID>

  const results = [];

  if (argUhid) {
    console.log(`▶ Running for single UHID: ${argUhid}`);

    const parent = await User.findOne({ uhid: argUhid })
      .select("_id uhid firstLpDepositTs")
      .lean();

    if (!parent) {
      console.error(`❌ No user found with uhid=${argUhid}`);
      await mongoose.connection.close();
      return;
    }

    const startDate =
      parent?.firstLpDepositTs || (await getSponsorStartDate(parent._id.toString()));

    const { closingBalance } = await computeChildrenClosingBalance(
      parent.uhid,
      startDate
    );

    console.log(
      `✅ UHID=${parent.uhid} ClosingBalance=${closingBalance}`
    );

    results.push({ uhid: parent.uhid, closingBalance });

    await Ledger.updateOne(
      { userId: parent._id },
      { $set: { "wallets.boost": closingBalance } }
    );
  } else {
    console.log("▶ No UHID provided — running for all parent UHIDs...");
    const parentUhids = await Level.distinct("parent", { level: 1 });

    for (const parentUhid of parentUhids) {
      const parent = await User.findOne({ uhid: parentUhid })
        .select("_id uhid firstLpDepositTs")
        .lean();
      if (!parent) continue;

      const startDate =
        parent?.firstLpDepositTs || (await getSponsorStartDate(parent._id.toString()));

      const { closingBalance } = await computeChildrenClosingBalance(
        parent.uhid,
        startDate
      );

      console.log(
        `Running for parent UHID=${parent.uhid} ... ClosingBalance=${closingBalance}`
      );

      results.push({ uhid: parent.uhid, closingBalance });

      await Ledger.updateOne(
        { userId: parent._id },
        { $set: { "wallets.boost": closingBalance } }
      );
    }
  }

  // Write results to CSV
  writeCsv(argUhid ? `boost_summary_${argUhid}.csv` : "boost_summary_all.csv", results);

  await mongoose.connection.close();
})();
