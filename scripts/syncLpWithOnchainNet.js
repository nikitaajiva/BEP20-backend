/**
 * SYNC LP WITH ON-CHAIN NET BALANCE
 * --------------------------------------
 * Rule:
 *  - deposits > withdrawals
 *  - current LP > (deposits - withdrawals)
 *
 * Update:
 *  - wallets.lp = deposits - withdrawals
 *  - wallets.zeroRisk = min(currentZeroRisk, deposits - withdrawals)
 *
 * LIVE by default
 * DRY RUN:
 *   DRY_RUN=true node scripts/syncLpWithOnchainNet.js
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
       STEP 3: LOAD LEDGERS
    ================================ */
    const ledgers = await Ledger.find(
      { userId: { $in: Object.keys(depositMap).map(id => new mongoose.Types.ObjectId(id)) } },
      { userId: 1, wallets: 1 }
    ).lean();

    const updates = [];

    for (const ledger of ledgers) {
      const uid = ledger.userId.toString();

      const deposits = depositMap[uid] || 0;
      const withdrawals = withdrawalMap[uid] || 0;

      if (deposits <= withdrawals) continue;

      const net = toNumber(deposits - withdrawals);

      const currentLP = toNumber(ledger.wallets?.lp);
      const currentZeroRisk = toNumber(ledger.wallets?.zeroRisk);

      if (currentLP <= net) continue;

      const newZeroRisk = Math.min(currentZeroRisk, net);

      updates.push({
        userId: ledger.userId,
        net,
        currentLP,
        currentZeroRisk,
        newZeroRisk,
      });
    }

    if (!updates.length) {
      console.log("ℹ️ No users matched update rules");
      process.exit(0);
    }

    console.log(`🔧 Users to sync LP: ${updates.length}`);
    console.log("🔍 Sample:", updates.slice(0, 3));

    if (DRY_RUN) {
      console.log("🟡 DRY RUN — NO DATABASE CHANGES");
      process.exit(0);
    }

    /* ===============================
       STEP 4: BACKUP (INLINE)
    ================================ */
    const userIds = updates.map(u => u.userId);

    await Ledger.updateMany(
      { userId: { $in: userIds } },
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

    console.log("💾 Wallet backup stored");

    /* ===============================
       STEP 5: APPLY UPDATES
    ================================ */
    const bulkOps = updates.map(u => ({
      updateOne: {
        filter: { userId: u.userId },
        update: {
          $set: {
            "wallets.lp": mongoose.Types.Decimal128.fromString(u.net.toString()),
            "wallets.zeroRisk": mongoose.Types.Decimal128.fromString(
              u.newZeroRisk.toString()
            ),
          },
        },
      },
    }));

    const res = await Ledger.bulkWrite(bulkOps);
    console.log(`✅ Updated ledgers: ${res.modifiedCount}`);

    await mongoose.disconnect();
    console.log("✅ DONE");
    process.exit(0);

  } catch (err) {
    console.error("❌ ERROR:", err);
    process.exit(1);
  }
}

main();
