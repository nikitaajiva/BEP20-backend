/**
 * Script: reprocessWithdrawals.js
 * Usage:
 *   node scripts/reprocessWithdrawals.js
 *   node scripts/reprocessWithdrawals.js --dry
 *   node scripts/reprocessWithdrawals.js --limit 5
 *   node scripts/reprocessWithdrawals.js --id 691111a1b2c3d4e5f6a7b8c9
 *   node scripts/reprocessWithdrawals.js --maxAmount 100
 *   node scripts/processWithdrawal.js --date 2025-12-23 --maxAmount 10
 *   node scripts/reprocessWithdrawals.js --from 2025-12-01 --to 2025-12-05
 *   node scripts/reprocessWithdrawals.js --walletFrom COMMUNITY_REWARDS
 */
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const connectDB = require("../config/db");
const { sendXrp } = require("../utils/transactions");

const DRY_MODE = process.argv.includes("--dry");
const XRPL_RPC_URL =
  "https://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7";


  async function unlockUserLedger(userId) {
  if (!userId) return;

  await Ledger.updateOne(
    { userId },
    {
      $set: {
        withdrawalDisabled: false,
        pendingWithdrawal: null,
      },
    }
  );
}
// ----------------------------------------------
// CLI ARG PARSING
// ----------------------------------------------
const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
};

// WALLET FROM FILTER
const WALLET_FROM = getArgValue("--walletFrom");
const FORCE_RETRY = process.argv.includes("--force-retry");
// MAX AMOUNT FILTER
const MAX_AMOUNT = (() => {
  const val = Number(getArgValue("--maxAmount"));
  return isNaN(val) ? null : val;
})();

// LIMIT ROWS
const LIMIT = (() => {
  const val = Number(getArgValue("--limit"));
  return isNaN(val) ? null : val;
})();
function generateRetryId(baseId) {
  const rand = Math.floor(Math.random() * 1e9);
  return `${baseId}_${Date.now()}_${rand}`;
}


// SPECIFIC WITHDRAWAL ID
const SPECIFIC_ID = getArgValue("--id");

// DATE FILTERS
const DATE_SINGLE = getArgValue("--date");
const DATE_FROM = getArgValue("--from");
const DATE_TO = getArgValue("--to");

// ----------------------------------------------
// PRINT MODE INFO
// ----------------------------------------------
console.log(`
=========================================================
 MODE          : ${DRY_MODE ? "🧪 DRY RUN (NO XRP SENT)" : "💸 LIVE MODE (REAL SEND)"}
 LIMIT         : ${LIMIT !== null ? LIMIT : "NONE"}
 TARGET ID     : ${SPECIFIC_ID || "N/A"}
 MAX AMOUNT    : ${MAX_AMOUNT !== null ? MAX_AMOUNT : "NONE"}
 WALLET FROM   : ${WALLET_FROM || "ALL"}
=========================================================
`);

const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const LedgerRow = require("../models/LedgerRow");
const Ledger = require("../models/Ledger");
const User = require("../models/User");

// ----------------------------------------------
// SUMMARY OBJECT
// ----------------------------------------------
const summary = {
  alreadyProcessedCount: 0,
  alreadyProcessedAmount: 0,
  sentCount: 0,
  sentAmount: 0,
  pendingCount: 0,
  pendingAmount: 0,
  failedCount: 0,
  failedAmount: 0,
};

// ----------------------------------------------
// DATE HELPERS
// ----------------------------------------------
function parseDateInput(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

let dateStart, dateEnd;

// SINGLE DATE
if (DATE_SINGLE) {
  const d = parseDateInput(DATE_SINGLE);
  if (!d) {
    console.error("❌ Invalid --date format. Use YYYY-MM-DD");
    process.exit(1);
  }
  dateStart = d;
  dateEnd = new Date(d);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
  
}

// RANGE
else if (DATE_FROM && DATE_TO) {
  const d1 = parseDateInput(DATE_FROM);
  const d2 = parseDateInput(DATE_TO);
  if (!d1 || !d2) {
    console.error("❌ Invalid --from or --to format. Use YYYY-MM-DD");
    process.exit(1);
  }
  dateStart = d1;
  dateEnd = new Date(d2);
  dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);
  
}

// DEFAULT: TODAY
else {
  const now = new Date();
  dateStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  dateEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  
}

// ----------------------------------------------
// XRP HELPERS
// ----------------------------------------------
function dropsToXRP(drops) {
  return Number(drops) / 1_000_000;
}

async function checkIfAlreadyProcessed(destination, amountXrp, dateStart, dateEnd) {
  try {
    const response = await axios.post(
      XRPL_RPC_URL,
      {
        method: "account_tx",
        params: [
          {
            account: destination,
            limit: 200,
            forward: false,
            ledger_index_min: -1,
            ledger_index_max: -1,
          },
        ],
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const txs = response.data?.result?.transactions || [];

    for (const entry of txs) {
      const tx = entry.tx;
      const meta = entry.meta;
      if (!tx || tx.TransactionType !== "Payment") continue;

      const rippleEpoch = tx.date;
      if (!rippleEpoch) continue;

      const txDate = new Date((rippleEpoch + 946684800) * 1000);
      if (txDate < dateStart || txDate >= dateEnd) continue;

      const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount ?? tx.Amount;
      if (!delivered) continue;

      let drops = 0;
      if (typeof delivered === "string") drops = Number(delivered);
      else if (delivered.currency === "XRP") drops = Number(delivered.value);

      const deliveredXrp = dropsToXRP(drops);

      if (Number(deliveredXrp.toFixed(6)) === Number(amountXrp.toFixed(6))) {
        
        return tx.hash;
      }
    }

    return false;
  } catch (err) {
    
    return false;
  }
}

// ----------------------------------------------
// MAIN FLOW
// ----------------------------------------------
async function start() {
  try {
    await connectDB();
    

    let logs = [];

    // SPECIFIC ID
    if (SPECIFIC_ID) {
      const doc = await WithdrawalErrorLog.findById(SPECIFIC_ID).lean();
      if (!doc) {
        
        process.exit(1);
      }
      logs.push(doc);
    }

    // OTHERWISE LOAD LOGS BY DATE RANGE + WALLET FILTER
    else {
      const query = {
        errorCode: { $ne: "RESOLVED" },
        createdAt: { $gte: dateStart, $lt: dateEnd },
      };

      if (WALLET_FROM) {
        query.walletFrom = WALLET_FROM;
        
      }

      logs = await WithdrawalErrorLog.find(query).lean();
    }

    

    // MAX AMOUNT FILTER
    if (MAX_AMOUNT !== null) {
      logs = logs.filter((l) => Number(l.amount) <= MAX_AMOUNT);
      
    }

    // LIMIT
    if (LIMIT && logs.length > LIMIT) logs.length = LIMIT;

    

    // MAIN PROCESS LOOP
    for (const log of logs) {
      
      

      const amountXrp = Number(log.amount);
      const dest = log.destinationAddress;

      // Check already sent on same day
      // const existingTx = await checkIfAlreadyProcessed(dest, amountXrp, dateStart, dateEnd);
      const existingTx = FORCE_RETRY
  ? false
  : await checkIfAlreadyProcessed(dest, amountXrp, dateStart, dateEnd);
      
      if (existingTx) {
        summary.alreadyProcessedCount++;
        summary.alreadyProcessedAmount += amountXrp;

        if (!DRY_MODE) {
          await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
            status: "COMPLETED",
            errorCode: "RESOLVED",
            txHash: existingTx,
            updatedAt: new Date(),
          });

          if (log.ledgerRowId)
            await LedgerRow.findByIdAndUpdate(log.ledgerRowId, {
              status: "COMPLETED",
              refId: existingTx,
            });
              await unlockUserLedger(log.userId);
        }
        continue;
      }

      // DRY MODE BEHAVIOR
      if (DRY_MODE) {
        
        summary.pendingCount++;
        summary.pendingAmount += amountXrp;
        continue;
      }

      // SEND XRP
   //   
      // const result = await sendXrp({
      //   idempotency_key: log.uniqueTransactionId,
      //   withdrawal_id: log._id,
      //   amount_xrp: amountXrp.toString(),
      //   destination: dest,
      // });

      // const txHash = result?.txHash;
      // SEND XRP (SAFE – does not stop loop)

let txHash = null;
const retryIdempotencyKey = FORCE_RETRY
  ? generateRetryId(log.uniqueTransactionId)
  : log.uniqueTransactionId;

const retryWithdrawalId = FORCE_RETRY
  ? generateRetryId(log._id.toString())
  : log._id.toString();

try {
const result = await sendXrp({
  idempotency_key: retryIdempotencyKey,
  withdrawal_id: retryWithdrawalId,
  amount_xrp: amountXrp.toString(),
  destination: dest,
});

  txHash = result?.txHash;
} catch (sendErr) {
  console.error("❌ sendXrp ERROR:", sendErr?.message || sendErr);

  summary.failedCount++;
  summary.failedAmount += amountXrp;

  await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
    status: "FAILED",
    errorCode: "SEND_XRP_ERROR",
    errorMessage: sendErr?.message || String(sendErr),
    updatedAt: new Date(),
  });

  // optional but RECOMMENDED: unlock user so they’re not stuck
 // await unlockUserLedger(log.userId);

  continue; // 🔥 THIS IS THE KEY
}

  //xrpTxHash = txResult.txHash;
      if (txHash) {
        summary.sentCount++;
        summary.sentAmount += amountXrp;

        await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
          status: "COMPLETED",
          errorCode: "RESOLVED",
          txHash,
          updatedAt: new Date(),
        });
        await unlockUserLedger(log.userId);
        if (log.ledgerRowId)
          await LedgerRow.findByIdAndUpdate(log.ledgerRowId, {
            status: "COMPLETED",
            refId: txHash,
          });
    
        const user = await User.findById(log.userId).lean();

        if (user) {
          
          
        }
      } else {
        

        summary.failedCount++;
        summary.failedAmount += amountXrp;

        await WithdrawalErrorLog.findByIdAndUpdate(log._id, {
          status: "FAILED",
          updatedAt: new Date(),
        });
      }
    }

    // ----------------------------------------------
    // SUMMARY OUTPUT
    // ----------------------------------------------
    console.log(`
==========================================================
                   📊 SUMMARY
==========================================================
Type                     Count        Total Amount (XRP)
----------------------------------------------------------
Already Processed     |  ${summary.alreadyProcessedCount}     |  ${summary.alreadyProcessedAmount.toFixed(6)}
Sent Successfully     |  ${summary.sentCount}     |  ${summary.sentAmount.toFixed(6)}
Pending (Dry)         |  ${summary.pendingCount}     |  ${summary.pendingAmount.toFixed(6)}
Failed                |  ${summary.failedCount}     |  ${summary.failedAmount.toFixed(6)}
==========================================================
`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Script Error:", err);
    process.exit(1);
  }
}

start();
