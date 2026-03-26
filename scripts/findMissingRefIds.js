/**
 * Find LedgerRows with missing refId and insert/update them
 * into WithdrawalErrorLogs (no duplicates).
 *
 * Added:
 *   - --dry flag (no DB writes, log only)
 *   - Duplicate cleanup:
 *        If duplicate LedgerRow exists within ±1 minute (same userId+eventType+amount)
 *        AND any duplicate has refId
 *        -> delete the missing-refId row + delete WithdrawalErrorLogs for same uniqueTransactionId (if exists)
 *
 * Rules (preserved from base):
 *   ➜ Only process users who have EXACTLY 1 LedgerRow for that day.
 *   ➜ If user has multiple rows → SKIP that user completely.
 *   ➜ Do NOT process LedgerRows newer than 5 minutes from current time.
 *   ➜ If LedgerRow already has ECOSYSTEM_FEE entry:
 *         - DO NOT create new EcosystemFee
 *         - DO NOT create new ECOSYSTEM_FEE LedgerRow
 *         - Use existing fee to update WithdrawalErrorLogs only
 *   ➜ If NO ECOSYSTEM_FEE exists:
 *         - Calculate eco fee using your logic (only for CR rules below)
 *         - Create EcosystemFee ONLY (NOT LedgerRow)
 *         - Update WithdrawalErrorLogs with correct finalAmount
 */

require("dotenv").config();
const mongoose = require("mongoose");

const connectDB = require("../config/db");
const LedgerRow = require("../models/LedgerRow");
const WithdrawalErrorLogs = require("../models/WithdrawalErrorLog");
const User = require("../models/User");

const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const EcosystemFee = require("../models/EcosystemFee");

// ------------------- CLI -------------------
const isDryRun = process.argv.includes("--dry");

// ------------------- Helpers -------------------
function toNumber(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  if (val._bsontype === "Decimal128") return parseFloat(val.toString());
  return Number(val) || 0;
}

function toDecimal128(num) {
  return mongoose.Types.Decimal128.fromString(Number(num).toFixed(6));
}

// ------------------- Get Onchain Totals -------------------
const getUserChainTotals = async (userId) => {
  const filter = { userId: new mongoose.Types.ObjectId(userId) };

  const [depositSummary] = await ChainDeposit.aggregate([
    { $match: filter },
    { $group: { _id: null, totalAmount: { $sum: "$amountXRP" } } },
  ]);

  const [withdrawalSummary] = await ChainWithdrawal.aggregate([
    { $match: filter },
    { $group: { _id: null, totalAmount: { $sum: "$amountXRP" } } },
  ]);

  return {
    totalDeposits: toNumber(depositSummary?.totalAmount),
    totalWithdrawals: toNumber(withdrawalSummary?.totalAmount),
  };
};

// ------------------- Total Ecosystem Fee Paid -------------------
const getTotalEcosystemFeeByUser = async (userId) => {
  const result = await EcosystemFee.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: "$userId", totalFee: { $sum: "$amount" } } },
  ]);

  return result?.length ? toNumber(result[0].totalFee) : 0;
};

// ------------------- Eco Fee Calculation -------------------
function calculateEcoFee({ amount, totalDeposits, totalWithdrawals, alreadyPaid }) {
  const amt = Number(amount);
  const deposits = Number(totalDeposits);
  const withdrawals = Number(totalWithdrawals);

  const projected = withdrawals + amt;

  if (projected <= deposits) {
    return { feeAmount: 0, finalAmount: amt };
  }

  let excess = projected - deposits;
  let rawFee = excess * 0.10;
  let fee = rawFee - alreadyPaid;

  if (fee < 0) fee = 0;
  if (fee > amt) fee = amt;

  return {
    feeAmount: +fee.toFixed(6),
    finalAmount: +(amt - fee).toFixed(6),
  };
}

// -------------------------------------------------------------
// MAIN SCRIPT
// -------------------------------------------------------------
async function run() {
  const dateArg = process.argv[2];
  if (!dateArg) {
    console.log("❌ Usage: node file.js YYYY-MM-DD [--dry]");
    process.exit(1);
  }

  const targetDate = new Date(dateArg);
  if (isNaN(targetDate.getTime())) {
    console.log("❌ Invalid date format");
    process.exit(1);
  }

  console.log(isDryRun ? "🧪 DRY RUN MODE (no DB writes)" : "🔥 LIVE MODE (will write/delete)");

  const start = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
    0, 0, 0, 0
  ));

  const endOfDay = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
    23, 59, 59, 999
  ));

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const effectiveEnd = fiveMinAgo < endOfDay ? fiveMinAgo : endOfDay;

  if (effectiveEnd <= start) {
    console.log("⛔ No valid time window (all rows within last 5 min).");
    process.exit(0);
  }

  await connectDB();
  console.log("⚡ DB Connected");

  const targetEvents = ["WITHDRAWAL", "REWARDS_REDEEMED"];

  const rows = await LedgerRow.find({
    eventType: { $in: targetEvents },
    refId: null,
    ts: { $gte: start, $lt: effectiveEnd },
  })
    .sort({ ts: 1 })
    .lean();

  if (!rows.length) {
    console.log("👍 No matching ledger rows.");
    process.exit(0);
  }

  // ----------------- Group by User ------------------
  const grouped = new Map();

  for (const r of rows) {
    const key = r.userId.toString();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }

  const filteredRows = [];
  let skippedMulti = 0;

  for (const [userId, list] of grouped.entries()) {
    if (list.length === 1) filteredRows.push(list[0]);
    else {
      skippedMulti++;
      console.log(`⛔ SKIP USER ${userId} → ${list.length} rows`);
    }
  }

  let inserted = 0,
    updated = 0,
    skippedNoChange = 0,
    skippedDuplicateNoRef = 0,
    deletedDuplicate = 0,
    deletedDuplicateLogs = 0;

  const results = [];

  // -------------------------------------------------
  // PROCESS EACH USER (1 LedgerRow per user)
  // -------------------------------------------------
  for (const row of filteredRows) {
    const user = await User.findById(row.userId).lean();
    const uhid = user?.uhid || "";
    const xrpAddress = user?.xrpAddress || "";

    const originalAmount = toNumber(row.amount);

    // ✅ Your original CR rule:
    const isCR =
      row.eventType === "REWARDS_REDEEMED" &&
      row.walletFrom === "COMMUNITY_REWARDS";

    // -------------------------------------------------
    // 🚨 DUPLICATE CHECK (±1 minute) + AUTO DELETE
    // -------------------------------------------------
    const oneMinuteMs = 2 * 60 * 1000;

    const duplicates = await LedgerRow.find({
      _id: { $ne: row._id },
      userId: row.userId,
      eventType: row.eventType,
      amount: row.amount,
      ts: {
        $gte: new Date(new Date(row.ts).getTime() - oneMinuteMs),
        $lte: new Date(new Date(row.ts).getTime() + oneMinuteMs),
      },
    })
      .select("_id ts refId uniqueTransactionId")
      .lean();

    if (duplicates.length > 0) {
      const validDup = duplicates.find((d) => d.refId);

      if (validDup) {
        console.log("🧹 DUPLICATE FOUND WITH VALID refId → DELETE missing-refId row", {
          uhid,
          userId: row.userId.toString(),
          eventType: row.eventType,
          amount: originalAmount,
          deleteLedgerRowId: row._id.toString(),
          keepLedgerRowId: validDup._id.toString(),
          keepRefId: validDup.refId,
          uniqueTransactionId: row.uniqueTransactionId,
        });

        if (!isDryRun) {
          // delete WithdrawalErrorLogs (if already inserted)
          const delLog = await WithdrawalErrorLogs.findOneAndDelete({
            uniqueTransactionId: row.uniqueTransactionId,
          });

          if (delLog) deletedDuplicateLogs++;

          // delete the invalid LedgerRow
          await LedgerRow.deleteOne({ _id: row._id });

          deletedDuplicate++;
        }

        results.push({
          uniqueTransactionId: row.uniqueTransactionId,
          uhid,
          finalAmount: null,
          ecoFee: null,
          status: isDryRun ? "WOULD_DELETE_DUPLICATE_LEDGERROW" : "DELETED_DUPLICATE_LEDGERROW",
          keptLedgerRowId: validDup._id.toString(),
        });

        continue;
      }

      // duplicates exist but none has refId → skip for manual review
      skippedDuplicateNoRef++;
      console.log("🚨 DUPLICATE DETECTED BUT NO refId IN ANY DUPLICATE → SKIP", {
        uhid,
        userId: row.userId.toString(),
        eventType: row.eventType,
        amount: originalAmount,
        ledgerRowId: row._id.toString(),
        duplicates: duplicates.map((d) => ({
          ledgerRowId: d._id.toString(),
          ts: d.ts,
          refId: d.refId || null,
          uniqueTransactionId: d.uniqueTransactionId || null,
        })),
      });

      results.push({
        uniqueTransactionId: row.uniqueTransactionId,
        uhid,
        finalAmount: null,
        ecoFee: null,
        status: "SKIPPED_DUPLICATE_NO_REFID",
      });

      continue;
    }

    // -------------------------------------------------
    // 🧩 Check existing ECOSYSTEM_FEE LedgerRow (base logic)
    // -------------------------------------------------
    const existingEcoLedger = await LedgerRow.findOne({
      eventType: "ECOSYSTEM_FEE",
      refId: row._id.toString(),
    }).lean();

    let ecoFee = 0;
    let finalAmount = originalAmount;

    if (existingEcoLedger) {
      ecoFee = toNumber(existingEcoLedger.amount);
      finalAmount = +(originalAmount - ecoFee).toFixed(6);

      console.log(`♻️ USING EXISTING ECOFEE for ${row.uniqueTransactionId}: ${ecoFee}`);
    } else if (isCR) {
      // Calculate fresh eco fee (base logic)
      const { totalDeposits, totalWithdrawals } = await getUserChainTotals(row.userId);
      const alreadyPaid = await getTotalEcosystemFeeByUser(row.userId);

      const eco = calculateEcoFee({
        amount: originalAmount,
        totalDeposits,
        totalWithdrawals,
        alreadyPaid,
      });

      ecoFee = eco.feeAmount;
      finalAmount = eco.finalAmount;

      if (ecoFee > 0) {
        if (isDryRun) {
          console.log("🧪 DRY: Would create EcosystemFee", {
            uhid,
            userId: row.userId.toString(),
            ecoFee,
            ledgerRefId: row._id.toString(),
          });
        } else {
          await EcosystemFee.create({
            userId: row.userId,
            amount: toDecimal128(ecoFee),
            walletFrom: "COMMUNITY_REWARDS",
            ledgerRefId: row._id.toString(),
            narrative: "Retroactive ecosystem fee",
            status: "CALCULATED_OFFLINE",
            createdAt: new Date(),
          });
        }
      }
    }

    const finalAmountD128 = toDecimal128(finalAmount);
    const ecoFeeD128 = toDecimal128(ecoFee);

    // ---------------------- Existing Log (base logic) -----------------------
    const existingLog = await WithdrawalErrorLogs.findOne({
      uniqueTransactionId: row.uniqueTransactionId,
    });

    if (existingLog) {
      const oldAmount = toNumber(existingLog.amount);
      const diff = Math.abs(oldAmount - finalAmount);

      // keep your original tolerance + ecoFee compare intent
      const ecoDiff =
        existingLog.ecosystemFeeAmount &&
        Math.abs(toNumber(existingLog.ecosystemFeeAmount) - ecoFee) > 0.0000005;

      if (diff > 0.0000005 || ecoDiff) {
        if (isDryRun) {
          console.log("🧪 DRY: Would update WithdrawalErrorLog", {
            uniqueTransactionId: row.uniqueTransactionId,
            oldAmount,
            newAmount: finalAmount,
            ecoFee,
          });
        } else {
          existingLog.amount = finalAmountD128;
          existingLog.finalAmount = finalAmountD128;
          existingLog.ecosystemFeeApplied = ecoFee > 0;
          existingLog.ecosystemFeeAmount = ecoFeeD128;
          existingLog.updatedAt = new Date();
          await existingLog.save();
        }

        updated++;

        results.push({
          uniqueTransactionId: row.uniqueTransactionId,
          finalAmount,
          ecoFee,
          uhid,
          xrpAddress,
          status: isDryRun ? "WOULD_UPDATE" : "UPDATED",
        });
      } else {
        skippedNoChange++;
        results.push({
          uniqueTransactionId: row.uniqueTransactionId,
          status: "NO_CHANGE",
        });
      }

      continue;
    }

    // ---------------------- INSERT NEW LOG (base logic) -----------------------
    if (isDryRun) {
      console.log("🧪 DRY: Would insert WithdrawalErrorLog", {
        uniqueTransactionId: row.uniqueTransactionId,
        uhid,
        finalAmount,
        ecoFee,
      });

      inserted++;
      results.push({
        uniqueTransactionId: row.uniqueTransactionId,
        finalAmount,
        ecoFee,
        uhid,
        xrpAddress,
        status: "WOULD_INSERT",
      });
      continue;
    }

    await WithdrawalErrorLogs.create({
      ledgerRowId: row._id,
      userId: row.userId,
      eventType: row.eventType,
      walletFrom: row.walletFrom,
      walletTo: row.walletTo,
      uniqueTransactionId: row.uniqueTransactionId,
      narrative: row.narrative || "",
      destinationAddress: xrpAddress,
      ts: row.ts,
      createdAt: row.ts,

      originalAmount: row.amount,
      amount: finalAmountD128,
      finalAmount: finalAmountD128,
      ecosystemFeeApplied: ecoFee > 0,
      ecosystemFeeAmount: ecoFeeD128,
    });

    inserted++;

    results.push({
      uniqueTransactionId: row.uniqueTransactionId,
      finalAmount,
      ecoFee,
      uhid,
      xrpAddress,
      status: "INSERTED",
    });
  }

  // ---------------------- SUMMARY -----------------------
  console.log("\n================ SUMMARY ================");
  console.log("Mode:", isDryRun ? "DRY" : "LIVE");
  console.log("Inserted:", inserted);
  console.log("Updated:", updated);
  console.log("Unchanged:", skippedNoChange);
  console.log("Skipped - multi rows:", skippedMulti);
  console.log("Skipped - dup (no refId):", skippedDuplicateNoRef);
  console.log("Deleted dup LedgerRows:", deletedDuplicate);
  console.log("Deleted dup WithdrawalErrorLogs:", deletedDuplicateLogs);
  console.log("=========================================\n");

  console.table(results);

  await mongoose.disconnect();
  console.log("🔌 DB Disconnected");
}

run();
