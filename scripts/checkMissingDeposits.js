/**
 * Check missing deposits in xrpdeposits and auto process failed ones
 *
 * Usage:
 *   node scripts/checkMissingDeposits.js
 *   node scripts/checkMissingDeposits.js 2025-09-15
 */

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const cDeposit = require("../models/ChainDeposit");
const XrpDeposit = require("../models/XrpDeposit");
const { addFailedXrpDepositsToXaman } = require("../controllers/supportController");

const LOGS_DIR = "/root/b/logs";
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

function getLogFileName() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `missing_deposits_${y}-${m}-${day}.log`);
}
const logFile = getLogFileName();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + "\n");
}

async function processFailedDeposit(deposit) {
  try {
    const mockReq = {
      body: {
        _id: deposit._id,
        walletAddress: deposit.walletAddress,
        transactionId: deposit.transactionId,
      },
    };
    const mockRes = {
      status: (code) => ({
        json: (data) => {
          log(`➡️ [${deposit.transactionId}] Status ${code}: ${data.message}`);
        },
      }),
    };
    await addFailedXrpDepositsToXaman(mockReq, mockRes);
  } catch (err) {
    log(`❌ [${deposit.transactionId}] Error processing deposit: ${err.message}`);
  }
}

// async function run() {
//   await connectDB();

//   const argDate = process.argv[2];
//   const targetDate = argDate ? new Date(argDate) : new Date();
//   const startOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 0, 0, 0));
//   const endOfDay = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 23, 59, 59));

//   log(`🔎 Checking cDeposits from ${startOfDay.toISOString()} → ${endOfDay.toISOString()}`);

//   const deposits = await cDeposit.find({
//     txDate: { $gte: startOfDay, $lte: endOfDay },
//   });

//   log(`📥 Found ${deposits.length} cDeposits`);
//   let created = 0;
//   let processed = 0;
//   const now = new Date();

//   for (const d of deposits) {
//     const ageMinutes = (now - d.txDate) / (1000 * 60);
//     if (ageMinutes < 4) {
//       log(`⏳ Skipping tx ${d.txHash} (only ${ageMinutes.toFixed(1)} min old)`);
//       continue;
//     }

//     let depositDoc = await XrpDeposit.findOne({ transactionId: d.txHash });
//     if (!depositDoc) {
//       depositDoc = await XrpDeposit.create({
//         user: d.userId,
//         walletAddress: d.source,
//         transactionId: d.txHash,
//         amount: d.raw?.tx?.Amount?.toString() || "0",
//         ledgerTimestamp: d.txDate,
//         status: "failed",
//         createdAt: new Date(),
//         processingError: null,
//       });
//       created++;
//       log(`⚠️ Missing deposit → Inserted failed xrpdeposit for tx ${d.txHash} amount=${d.raw?.tx?.Amount}`);
//     }

//     if (depositDoc.status === "failed") {
//       await processFailedDeposit(depositDoc);
//       processed++;
//     } else {
//     //  log(`✅ Skipped tx ${d.txHash} (status=${depositDoc.status})`);
//     }
//   }

//   log(`🏁 Finished. Created: ${created}, Processed: ${processed} failed deposits`);
//   process.exit(0);
// }

async function run() {
  await connectDB();

  const argDate = process.argv[2];

  // Build correct target date without timezone issues
  let targetDate;
  if (argDate) {
    const [year, month, day] = argDate.split("-");
    targetDate = new Date(Date.UTC(year, month - 1, day));
    log(`📅 Running for passed date: ${argDate}`);
  } else {
    const today = new Date();
    targetDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    log(`📅 Running for TODAY`);
  }

  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  log(`🔎 Checking cDeposits between:`);
  log(`   Start: ${startOfDay.toISOString()}`);
  log(`   End:   ${endOfDay.toISOString()}`);

  const deposits = await cDeposit.find({
    txDate: { $gte: startOfDay, $lte: endOfDay },
  });

  log(`📥 Found ${deposits.length} cDeposits`);
  let created = 0;
  let processed = 0;
  const now = new Date();

  for (const d of deposits) {
    const ageMinutes = (now - d.txDate) / (1000 * 60);
    if (ageMinutes < 4) {
      log(`⏳ Skipping tx ${d.txHash} (only ${ageMinutes.toFixed(1)} min old)`);
      continue;
    }

    let depositDoc = await XrpDeposit.findOne({ transactionId: d.txHash });
    if (!depositDoc) {
      depositDoc = await XrpDeposit.create({
        user: d.userId,
        walletAddress: d.source,
        transactionId: d.txHash,
        amount: d.raw?.tx?.Amount?.toString() || "0",
        ledgerTimestamp: d.txDate,
        status: "failed",
        createdAt: new Date(),
        processingError: null,
      });
      created++;
      log(`⚠️ Missing deposit → Inserted failed xrpdeposit for tx ${d.txHash} amount=${d.raw?.tx?.Amount}`);
    }

    if (depositDoc.status === "failed") {
      await processFailedDeposit(depositDoc);
      processed++;
    }
  }

  log(`🏁 Finished. Created: ${created}, Processed: ${processed} failed deposits`);
  process.exit(0);
}


run().catch((err) => {
  log("❌ Error: " + err.message);
  process.exit(1);
});
