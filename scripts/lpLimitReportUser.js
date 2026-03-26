// scripts/userReport.js
const mongoose = require("mongoose");
const path = require("path");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const Excel = require("exceljs");

function toISO(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}
function toAmountNumber(v) {
  if (!v) return 0;
  return typeof v === "number" ? v : Number(v);
}

async function getFirstLpDate(user) {
  if (user.firstLpDepositTs) return user.firstLpDepositTs;

  const firstLedger = await LedgerRow.findOne({
    userId: user._id,
    eventType: "LP_DEPOSIT_FROM_XAMAN",
  })
    .sort({ ts: 1 })
    .lean();

  return firstLedger?.ts || null;
}

async function exportUserReport(user, filename) {
  const baseDate = await getFirstLpDate(user);
  if (!baseDate) {
    console.error(`⚠️ User ${user.uhid} has no first LP date`);
    return;
  }

  // cutoff date = +30d
  const cutoffDate = new Date(baseDate);
  cutoffDate.setDate(cutoffDate.getDate() + 30);
  cutoffDate.setHours(0, 0, 0, 0);

  // fetch ALL ledger rows
  const events = await LedgerRow.find({
    userId: user._id,
    eventType: {
      $in: [
        "AUTOPOSITIONING",
        "DEPOSIT",
        "LP_DEPOSIT_FROM_REWARDS",
        "LP_DEPOSIT_FROM_XAMAN",
        "REWARDS_REDEEMED",
        "WITHDRAWAL",
      ],
    },
  })
    .sort({ ts: 1 })
    .lean();

  let lpBalance = 0;
  let postCutoffDeposits = 0;
  const processedRows = [];

  for (const r of events) {
    const amt = toAmountNumber(r.amount);
    let note = "";

    if (r.ts <= cutoffDate) {
      // within first 30 days
      switch (r.eventType) {
        case "AUTOPOSITIONING":
        case "LP_DEPOSIT_FROM_REWARDS":
        case "LP_DEPOSIT_FROM_XAMAN":
          lpBalance += amt;
          note = "Pre-cutoff LP deposit → added";
          break;
        case "WITHDRAWAL":
          lpBalance -= amt;
          if (lpBalance < 0) lpBalance = 0; // ✅ cap at zero
          note = "Pre-cutoff withdrawal → reduced LP";
          break;
        default:
          note = "Pre-cutoff non-LP event (ignored for cap)";
      }
    } else {
      // after 30-day cutoff
      if (
        ["AUTOPOSITIONING", "LP_DEPOSIT_FROM_REWARDS", "LP_DEPOSIT_FROM_XAMAN"].includes(
          r.eventType
        )
      ) {
        postCutoffDeposits += amt;
        note = "Post-cutoff deposit → ignored (only offsets withdrawals)";
      }

      if (r.eventType === "WITHDRAWAL") {
        if (amt > postCutoffDeposits) {
          const excess = amt - postCutoffDeposits;
          lpBalance -= excess;
          if (lpBalance < 0) lpBalance = 0; // ✅ cap at zero
          postCutoffDeposits = 0;
          note = `Post-cutoff withdrawal → exceeded deposits, reduced LP by ${excess}`;
        } else {
          postCutoffDeposits -= amt;
          note = "Post-cutoff withdrawal → offset by deposits (no LP impact)";
        }
      }
    }

    processedRows.push({
      ts: toISO(r.ts),
      eventType: r.eventType,
      amount: amt,
      lpBalance,
      buffer: postCutoffDeposits,
      note,
    });
  }

  // --- update Ledger with frozen LP cap ---
  await Ledger.updateOne(
    { userId: new mongoose.Types.ObjectId(user._id) },
    {
      $set: {
        "limits.boostLimit.cap": mongoose.Types.Decimal128.fromString(lpBalance.toString()),
      },
    }
  );

  // --- Excel output ---
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("Ledger Report");

  ws.columns = [
    { header: "UHID", key: "uhid", width: 18 },
    { header: "Username", key: "username", width: 20 },
    { header: "First LP Date", key: "baseDate", width: 22 },
    { header: "Cutoff Date (+30d)", key: "cutoffDate", width: 22 },
    { header: "Event Time", key: "ts", width: 22 },
    { header: "Event Type", key: "eventType", width: 28 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Closing LP Balance", key: "lpBalance", width: 20 },
    { header: "Post-Cutoff Buffer", key: "buffer", width: 20 },
    { header: "Notes", key: "note", width: 50 },
  ];

  for (const row of processedRows) {
    ws.addRow({
      uhid: user.uhid,
      username: user.username,
      baseDate: toISO(baseDate),
      cutoffDate: toISO(cutoffDate),
      ts: row.ts,
      eventType: row.eventType,
      amount: row.amount,
      lpBalance: row.lpBalance,
      buffer: row.buffer,
      note: row.note,
    });
  }

  // summary row
  ws.addRow({});
  ws.addRow({
    uhid: user.uhid,
    username: user.username,
    baseDate: toISO(baseDate),
    cutoffDate: toISO(cutoffDate),
    eventType: "FINAL",
    lpBalance,
    buffer: postCutoffDeposits,
    note: "Frozen LP cap till now (never below 0)",
  });

  await wb.xlsx.writeFile(filename);
  console.log(`✅ Detailed report saved: ${filename}`);
}

(async () => {
  await connectDB();

  const uhid = process.argv[2];

  if (uhid) {
    // --- single user mode ---
    const user = await User.findOne({ uhid }).select("_id uhid username firstLpDepositTs").lean();
    if (!user) {
      console.error("❌ No user found for uhid:", uhid);
      process.exit(1);
    }
    const outPath = path.join(process.cwd(), `lp_user_report_${uhid}.xlsx`);
    await exportUserReport(user, outPath);
  } else {
    // --- all users mode ---
    const users = await User.find({}).select("_id uhid username firstLpDepositTs").lean();
    console.log(`👥 Processing ${users.length} users...`);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const baseDate = await getFirstLpDate(user);
      if (!baseDate) {
        console.log(`[${i + 1}/${users.length}] ${user.uhid} ❌ no LP date`);
        continue;
      }

      const cutoffDate = new Date(baseDate);
      cutoffDate.setDate(cutoffDate.getDate() + 30);
      cutoffDate.setHours(0, 0, 0, 0);

      console.log(
        `[${i + 1}/${users.length}] ${user.uhid} | ${user.username} | First LP: ${toISO(
          baseDate
        )} | Cutoff: ${toISO(cutoffDate)}`
      );
    }
  }

  await mongoose.connection.close();
})();
