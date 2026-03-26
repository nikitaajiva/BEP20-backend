/**
 * ZERO LP + ZERO RISK (BULK ENFORCER)
 * -----------------------------------------
 * LIVE by default
 *
 * Rule:
 * 1) deposits = 0 && withdrawals > 0  → ZERO
 * 2) withdrawals >= deposits (1x or more) → ZERO
 *
 * Optional:
 *   DRY_RUN=true node scripts/zeroLpIfWithdrawalMismatch.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const Ledger = require("../models/Ledger");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");

/* ===============================
   SAFE NUMBER NORMALIZER
================================ */
const toNumber = (val, decimals = 8) => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(decimals));
};

async function main() {
  // LIVE by default
  const DRY_RUN = process.env.DRY_RUN === "true";

  try {
    await connectDB();
    console.log("✅ Connected to DB");
    console.log(`🚦 MODE: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

    /* ===============================
       STEP 1: AGGREGATE DEPOSITS
    ================================ */
    const depositsAgg = await ChainDeposit.aggregate([
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
    ]);

    const depositMap = Object.fromEntries(
      depositsAgg.map(d => [d._id.toString(), toNumber(d.total)])
    );

    /* ===============================
       STEP 2: AGGREGATE WITHDRAWALS
    ================================ */
    const withdrawalsAgg = await ChainWithdrawal.aggregate([
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
    ]);

    const withdrawalMap = Object.fromEntries(
      withdrawalsAgg.map(w => [w._id.toString(), toNumber(w.total)])
    );

    /* ===============================
       STEP 3: DETECT VIOLATORS
    ================================ */
    const allUserIds = new Set([
      ...Object.keys(depositMap),
      ...Object.keys(withdrawalMap),
    ]);

    const usersToZero = [];

    for (const uid of allUserIds) {
      const deposits = depositMap[uid] || 0;
      const withdrawals = withdrawalMap[uid] || 0;

      // Rule 1: withdrawals without deposits
      if (deposits === 0 && withdrawals > 0) {
        usersToZero.push(uid);
        continue;
      }

      // Rule 2: withdrawals >= deposits (1x or more)
      if (deposits > 0 && withdrawals >= deposits) {
        usersToZero.push(uid);
      }
    }

    if (!usersToZero.length) {
      console.log("ℹ️ No users matched zeroing rules");
      process.exit(0);
    }

    console.log(`🚨 Users to ZERO LP & ZeroRisk: ${usersToZero.length}`);

    // Preview sample
    console.log("🔍 Sample userIds:", usersToZero.slice(0, 5));

    if (DRY_RUN) {
      console.log("🟡 DRY RUN ENABLED — NO DATABASE CHANGES");
      process.exit(0);
    }

    const userObjectIds = usersToZero.map(
      id => new mongoose.Types.ObjectId(id)
    );

    /* ===============================
       STEP 4: BACKUP (SAME COLLECTION)
    ================================ */
    const backupRes = await Ledger.updateMany(
      { userId: { $in: userObjectIds } },
      [
        {
          $set: {
            walletsBackup: {
              lp: "$wallets.lp",
              zeroRisk: "$wallets.zeroRisk",
              backedUpAt: new Date(),
            },
          },
        },
      ]
    );

    console.log(`💾 Backup stored for ${backupRes.modifiedCount} ledgers`);

    /* ===============================
       STEP 5: ZERO LP & ZERO RISK
    ================================ */
    const zeroRes = await Ledger.updateMany(
      { userId: { $in: userObjectIds } },
      {
        $set: {
          "wallets.lp": mongoose.Types.Decimal128.fromString("0"),
          "wallets.zeroRisk": mongoose.Types.Decimal128.fromString("0"),
        },
      }
    );

    console.log(`🔥 Zeroed wallets for ${zeroRes.modifiedCount} ledgers`);

    await mongoose.disconnect();
    console.log("✅ DONE — LIVE UPDATE COMPLETED");
    process.exit(0);

  } catch (err) {
    console.error("❌ ERROR:", err);
    process.exit(1);
  }
}

main();
