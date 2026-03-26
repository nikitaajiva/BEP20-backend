/**
 * Script: resolveWithdrawalErrorLogs.js
 *
 * Purpose:
 *   For a given date range, scan WithdrawalErrorLogs and check on XRPL
 *   if the user's destination address has already received the expected amount.
 *
 *   If a matching Payment is found:
 *     - Mark the WithdrawalErrorLog as RESOLVED + COMPLETED
 *     - Set txHash on the log
 *     - Update linked LedgerRow (if ledgerRowId present) with status COMPLETED and refId = txHash
 *
 * New Logic:
 *   - If we find a Payment from OUR_WITHDRAWAL_SOURCES to the destination
 *   - In the given date range
 *   - And the delivered amount (rounded to 6 decimals) is:
 *       * EQUAL to expected amount, OR
 *       * LESS than expected amount
 *   - AND that tx.hash is NOT already used in any LedgerRow.refId
 *   => We treat that TX as the successful withdrawal and resolve the log.
 *
 * Usage:
 *   node scripts/resolveWithdrawalErrorLogs.js --from 2025-09-23
 *   node scripts/resolveWithdrawalErrorLogs.js --from 2025-09-23 --to 2025-09-24
 *   node scripts/resolveWithdrawalErrorLogs.js --from 2025-09-23 --limit 50
 *   node scripts/resolveWithdrawalErrorLogs.js --from 2025-09-23 --id 6789abcdef...   (single log)
 */

require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const connectDB = require("../config/db");

const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const LedgerRow = require("../models/LedgerRow");

const XRPL_RPC_URL =
  "https://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7";

// ----------------------------- OUR WITHDRAWAL SOURCES (same as trackChainTx) -----------------------------
const OUR_WITHDRAWAL_SOURCES = [
  "rGPty1yQisw4z5soKZauz1Dc3xzeoyoMe3",
  "rGz9b8um4jVL5S4RP7Uvwej2D2dGGzowh",
    "rn5RiVQLZyE7TMTy68gVFF5HN8Qc2Pzf5b",
    "rw9Dta7f3VEghQmRXmgfPAbS8QGXpPK43W",
    "rJAVCMtwrjQTbkKMdoGCKJT3wLGc9hhByC",
    "ryxdd57ADJCrkMXffTBkALZYX33FJhMhi",
    "rNfsD8kRgZ5y3F5PkfxCMpgKKzX9eFWaAB",
"rUM4sBip3mq1exNSkAa1L7LuExc1d67xgB",
"rMaWxDUNGeCxCBW5reh491XQyjqeS3nmrE",
"rK25WEDw4xE1pH3aqS75gAcakZLJ622BkB",
"rhape1GpxNi7kaRG4gDV7Xe1egcLqzMDjJ"
];

// ----------------------------- CLI ARG PARSING -----------------------------
const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
};

const FROM_STR = getArgValue("--from");
const TO_STR = getArgValue("--to");
const LIMIT = (() => {
  const val = Number(getArgValue("--limit"));
  return isNaN(val) ? null : val;
})();
const SPECIFIC_ID = getArgValue("--id");

if (!FROM_STR) {
  console.error("❌ Please provide --from YYYY-MM-DD");
  process.exit(1);
}

function parseDateYMD(str) {
  const [y, m, d] = str.split("-").map((x) => Number(x));
  if (!y || !m || !d) {
    throw new Error(`Invalid date format: ${str}. Expected YYYY-MM-DD`);
  }
  return { year: y, month: m - 1, day: d };
}

let fromUTC, toUTC;
try {
  const from = parseDateYMD(FROM_STR);
  const to = TO_STR ? parseDateYMD(TO_STR) : from;

  fromUTC = new Date(Date.UTC(from.year, from.month, from.day));
  // end is next day of "to"
  toUTC = new Date(Date.UTC(to.year, to.month, to.day + 1));
} catch (err) {
  console.error("❌ Date parsing error:", err.message);
  process.exit(1);
}

console.log(`
================================================
  🧾 resolveWithdrawalErrorLogs
------------------------------------------------
  FROM (UTC): ${fromUTC.toISOString()}
  TO   (UTC): ${toUTC.toISOString()}
  LIMIT     : ${LIMIT !== null ? LIMIT : "NONE"}
  SPECIFIC  : ${SPECIFIC_ID || "N/A"}
================================================
`);

// ----------------------------- HELPERS -----------------------------

function rippleTimeToDate(rippleSeconds) {
  return new Date((rippleSeconds + 946684800) * 1000);
}

function safeNumber(val) {
  if (val == null) return 0;
  if (typeof val === "object" && val._bsontype === "Decimal128") {
    return Number(val.toString());
  }
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Check on XRPL if the destination account has already received
 * the given amount within [fromUTC, toUTC), from one of OUR_WITHDRAWAL_SOURCES.
 *
 * NEW LOGIC:
 *   - If a Payment is found TO destination
 *   - FROM one of OUR_WITHDRAWAL_SOURCES
 *   - IN date range
 *   - AND deliveredXrp <= amountXrp  (after rounding to 6 decimals)
 *   - AND that tx.hash is NOT used in any LedgerRow.refId
 *
 * Returns txHash if found, otherwise false.
 */
async function checkIfCreditedOnChain(destination, amountXrp, fromUTC, toUTC) {
  try {
    const response = await axios.post(
      XRPL_RPC_URL,
      {
        method: "account_tx",
        params: [
          {
            account: destination,
            ledger_index_min: -1,
            ledger_index_max: -1,
            limit: 500, // reasonably high; can be adjusted
            forward: false,
          },
        ],
        id: 1,
        jsonrpc: "2.0",
      },
      { headers: { "Content-Type": "application/json" }, timeout: 20000 }
    );

    const txs = response.data?.result?.transactions || [];

    for (const entry of txs) {
      const tx = entry.tx;
      const meta = entry.meta;
      if (!tx || tx.TransactionType !== "Payment") continue;

      // ✅ Must be incoming payment to this destination
      if (tx.Destination !== destination) continue;

      // ✅ Must come from one of our withdrawal hot wallets
      if (!OUR_WITHDRAWAL_SOURCES.includes(tx.Account)) continue;

      const rippleEpoch = tx.date;
      if (!rippleEpoch) continue;

      const txDateUTC = rippleTimeToDate(rippleEpoch);
      if (txDateUTC < fromUTC || txDateUTC >= toUTC) continue;

      const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount ?? tx.Amount;
      if (!delivered) continue;

      let deliveredXrp = 0;

      if (typeof delivered === "string") {
        // native XRP in drops
        const drops = Number(delivered);
        if (Number.isNaN(drops)) continue;
        deliveredXrp = drops / 1_000_000;
      } else if (typeof delivered === "object") {
        // issued currency or object form; only accept XRP
        if (delivered.currency !== "XRP" || delivered.value == null) continue;
        deliveredXrp = Number(delivered.value);
      } else {
        continue;
      }

      const deliveredRounded = Number(deliveredXrp.toFixed(6));
      const expectedRounded = Number(amountXrp.toFixed(6));

      // 🔍 Make sure this chain TX is not already tied to any LedgerRow
      const alreadyUsed = await LedgerRow.findOne({ refId: tx.hash }).lean();
      if (alreadyUsed) {
        console.log(
          `🔁 Skipping TX ${tx.hash} – already linked to LedgerRow ${alreadyUsed._id}`
        );
        continue;
      }

      // ✅ Old behaviour: exact match
      if (deliveredRounded === expectedRounded) {
        console.log(
          `🟢 Exact match for ${destination}: ${deliveredRounded} XRP (TX: ${tx.hash})`
        );
        return tx.hash;
      }

      // ✅ New behaviour: allow <= expected amount (and not bound to any LedgerRow)
      if (deliveredRounded < expectedRounded) {
        console.log(
          `🟢 Using on-chain withdrawal ${tx.hash} for ${destination}: ` +
            `${deliveredRounded} XRP ≤ expected ${expectedRounded} XRP`
        );
        return tx.hash;
      }
    }

    return false;
  } catch (err) {
    console.error(`⚠️ XRPL check failed for ${destination}:`, err.message);
    return false;
  }
}

// ----------------------------- MAIN -----------------------------
async function start() {
  try {
    await connectDB();
    console.log("✅ MongoDB connected successfully");

    let logs = [];

    if (SPECIFIC_ID) {
      const single = await WithdrawalErrorLog.findById(SPECIFIC_ID).lean();
      if (single) logs.push(single);
      else {
        console.log(`❌ No WithdrawalErrorLog found with ID: ${SPECIFIC_ID}`);
        process.exit(1);
      }
    } else {
      logs = await WithdrawalErrorLog.find({
        errorCode: { $ne: "RESOLVED" },
        createdAt: { $gte: fromUTC, $lt: toUTC },
        destinationAddress: { $exists: true, $ne: "" },
        amount: { $exists: true },
      })
        .sort({ createdAt: 1 })
        .lean();
    }

    if (LIMIT && logs.length > LIMIT) logs.length = LIMIT;

    console.log(`\n📌 Found ${logs.length} log(s) to inspect.\n`);

    const summary = {
      resolved: 0,
      unresolved: 0,
      resolvedAmount: 0,
    };

    for (const log of logs) {
      console.log("------------------------------------------------");
      console.log(`🧾 Log ID: ${log._id}`);
      console.log(`→ Destination: ${log.destinationAddress}`);
      console.log(`→ Amount (XRP): ${safeNumber(log.amount)}`);
      console.log(`→ uniqueTransactionId: ${log.uniqueTransactionId || "N/A"}`);

      const amountXrp = safeNumber(log.amount);
      const destination = log.destinationAddress;

      if (!destination || !amountXrp) {
        console.log("❌ Missing destination or amount; skipping.");
        summary.unresolved++;
        continue;
      }

      const txHash = await checkIfCreditedOnChain(
        destination,
        amountXrp,
        fromUTC,
        toUTC
      );

      if (txHash) {
        // Mark RESOLVED + COMPLETED
        await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
          errorCode: "RESOLVED",
          status: "COMPLETED",
          txHash,
          updatedAt: new Date(),
        });

        if (log.ledgerRowId) {
          await LedgerRow.findByIdAndUpdate(log.ledgerRowId, {
            status: "COMPLETED",
            refId: txHash,
          });
        }

        summary.resolved++;
        summary.resolvedAmount += amountXrp;

        console.log("✅ Marked as RESOLVED & COMPLETED");
      } else {
        summary.unresolved++;
        console.log("🟡 No matching on-chain payment found in this date range.");
      }
    }

    console.log(`
==========================================================
                     📊 SUMMARY
==========================================================
Date Range (UTC): ${fromUTC.toISOString()}  →  ${toUTC.toISOString()}

Resolved logs   : ${summary.resolved}
Unresolved logs : ${summary.unresolved}
Resolved Amount : ${summary.resolvedAmount.toFixed(6)} XRP
==========================================================
`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Script Error:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

start();
