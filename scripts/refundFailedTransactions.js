/*
  Audit Pending Withdrawals Script
  --------------------------------
  For every ledger where `withdrawalDisabled=true` and a `pendingWithdrawal` exists, this script:
    1. Computes on-chain deposits & withdrawals (collections `cDeposits` / `cWithdrawals`).
    2. Calculates an expected LP balance using the formula:
         expectedLP = (onchainDeposits * 5)  // 5-X earning potential
                      - onchainWithdrawals
                      - communityRewards
                      - xaman

       NOTE: If your definition of “5X” differs, adjust the multiplier below.

    3. Compares the expected LP to the actual LP wallet. If the actual LP is lower and the
       shortfall ≈ pendingWithdrawal.amount, we flag the ledger as NEEDS_REFUND. Otherwise we
       assume the withdrawal succeeded (or mismatch is within tolerance).

  Run with:  node backend/scripts/auditPendingWithdrawals.js   [--dry]
*/

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const Decimal128 = require("mongodb").Decimal128;
const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const { addDecimal128 } = require("../utils/decimal128Utils");

const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}
const LOG_DIR = path.join(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "processFailedTransactions.log");

function logToFile(message) {
  const logMsg = `[${new Date().toISOString()}] ${message}\n`;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, logMsg);
}

// Create a writable stream that appends to the log file
const logFilePath = path.join(logsDir, "pendingWithdrawals.log");
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

function log(message, writeToFile = true) {
  const timestamp = new Date().toISOString(); // UTC timestamp
  const fullMessage = `[${timestamp}] ${message}`;

  console.log(fullMessage);

  if (writeToFile) {
    logStream.write(fullMessage + "\n");
  }
}

const { Schema } = mongoose;
const txFields = {
  amountXRP: Number,
  userId: { type: Schema.Types.ObjectId, ref: "User" },
};
const Deposit = mongoose.model(
  "TmpChainDeposit",
  new Schema(txFields),
  "cDeposits"
);
const Withdrawal = mongoose.model(
  "TmpChainWithdrawal",
  new Schema(txFields),
  "cWithdrawals"
);

const MULTIPLIER_5X = 5; // change if your 5× definition is different
const TOL = 0.001; // tolerance for float comparisons (in XRP)
const isDryRun = process.argv.includes("--dry");

// ⛔ wallets we don't touch during refund processing
const SKIP_WALLETS = new Set(["ZERO_RISK"]);

function d2n(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  return parseFloat(val.toString());
}

(async function main() {
  try {
    await connectDB();

    const ledgers = await Ledger.find({ withdrawalDisabled: true }).lean();

    console.log(
      `Found ${ledgers.length} ledgers with withdrawalDisabled & pendingWithdrawal`
    );

    let needsRefund = 0;
    let alreadyPaid = 0;
    let withdrawalsMatched = 0;
    let unMatchedWithdrawals = {};
    let refundsProcessed = 0;

    /****On Failed Transactions Activity
       * 1. Create Refund Status Ledger Rows again each rows instered agains that failed unique trasaction id
       * 2. Update the Wallet refund amount in User ledger
       * 3. Update  userledger.withdrawalDisabled = false;
                    userledger.pendingWithdrawal = null;
      */
    async function refundFailedTransactions(lgrows = []) {
      if (!lgrows || lgrows.length === 0) {
        logToFile("No ledger rows found for refund creation.");
        return;
      }

      const walletMap = {
        COMMUNITY_REWARDS: "communityRewards",
        LP: "lp",
        ZERO_RISK: "zeroRisk", // left for mapping completeness; we skip before using it
        SWIFT: "swift",
        BOOST: "boost",
        AIRDROP: "airdrop",
        CASCADE_REWARDS: "cascadeRewards",
        RANK_REWARDS: "rankRewards",
        DAILY_CASCADE_REWARDS: "dailyCascadeRewards",
        DAILY_LEVEL_BOOSTER_BONUS: "dailyLevelBoosterBonus",
        DAILY_RANK_BONUS: "dailyRankBonus",
        LEVEL_BOOSTER_BONUS: "levelBoosterBonus",
        RANK_BONUS: "rankBonus",
        COMMUNITY_BOOSTER_BONUS: "communityBoosterBonus",
        DAILY_X_BONUS: "dailyXBonus",
        X_BONUS: "xBonus",
      };

      for (const original of lgrows) {
        try {
          // ✅ Skip any row that touches ZERO_RISK (do nothing)
          if (
            SKIP_WALLETS.has(original.walletFrom) ||
            SKIP_WALLETS.has(original.walletTo)
          ) {
            logToFile(
              `Skipping refund for ZERO_RISK wallet. TxID: ${original.uniqueTransactionId}, ` +
                `walletFrom=${original.walletFrom}, walletTo=${original.walletTo}`
            );
            continue;
          }

          const newLedgerRow = new LedgerRow({
            userId: original.userId,
            eventType: "DEPOSIT",
            walletFrom: original.walletTo,
            walletTo: original.walletFrom,
            amount: original.amount,
            narrative: `Refund processed for unsuccessful transaction (${original.eventType}) linked to TxID: ${original.uniqueTransactionId}`,
            cascadeProcessed: false,
            positioningBonusProcessed: false,
            communityBoosterProcessed: false,
            x1Processed: false,
            transactionId: original.uniqueTransactionId,
            status: "REFUNDED",
            ts: new Date(),
          });

          await newLedgerRow.save();
          logToFile(
            `Refund (${original.amount}) ledger created for userId: ${original.userId}`
          );

          const walletKey = walletMap[original.walletFrom];
          if (!walletKey) {
            logToFile(`Wallet mapping not found for: ${original.walletFrom}`);
            continue;
          }

          const userLedger = await Ledger.findOne({
            userId: original.userId,
          });
          if (!userLedger) {
            logToFile(`UserLedger not found for userId: ${original.userId}`);
            continue;
          }

          if (!userLedger.wallets[walletKey]) {
            userLedger.wallets[walletKey] = Decimal128.fromString("0");
          }

          const current = parseFloat(userLedger.wallets[walletKey].toString());
          const refund = parseFloat(original.amount.toString());
          const updated = current + refund;
          userLedger.wallets[walletKey] = Decimal128.fromString(
            updated.toString()
          );

          userLedger.withdrawalDisabled = false;
          userLedger.pendingWithdrawal = null;

          await userLedger.save();
          logToFile(
            `Wallet (${walletKey}) refund amount (${original.amount}),previous balance (${current}) and flags updated for userId: ${original.userId}`
          );
        } catch (error) {
          logToFile(
            `Error processing userId ${original.userId}: ${error.message}`
          );
        }
      }
    }

    for (const lg of ledgers) {
      const userId = lg._id;
      console.log("UHID============================", lg.uhid);

      // 🔎 Only fetch rows for this Tx that don't touch ZERO_RISK (belt-and-suspenders)
      const lgrows = await LedgerRow.find({
        uniqueTransactionId: lg.pendingWithdrawal?.uniqueTransactionId,
        $and: [{ walletFrom: { $ne: "ZERO_RISK" } }, { walletTo: { $ne: "ZERO_RISK" } }],
      }).lean();

      await refundFailedTransactions(lgrows);

      // Aggregate on-chain deposits & withdrawals
      const [depAgg] = await Deposit.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: "$amountXRP" } } },
      ]);
      const [withAgg] = await Withdrawal.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: "$amountXRP" } } },
      ]);

      const deposits = d2n(depAgg?.total);
      const withdrawals = d2n(withAgg?.total);

      const communityRewards = d2n(lg.wallets?.communityRewards);
      const xaman = d2n(lg.wallets?.xaman);
      const lp = d2n(lg.wallets?.lp);
      const fiveX = d2n(lg.limits.fiveXLimit.used);
      const expectedLP =
        deposits + fiveX - withdrawals - communityRewards - xaman;
      const diff = expectedLP - lp; // positive diff means there had been unrecorded withdrawals
      const errLog = await mongoose.connection
        .collection("withdrawalerrorlogs")
        .find({ userId })
        .project({ amount: 1 }) // Only need the amount
        .sort({ _id: -1 }) // Latest entry first
        .limit(1)
        .toArray();

      const pendingAmt = d2n(errLog[0]?.amount);

      /* If pendingAmt is greater than 0, release lock (optional behavior remains) */
      if (pendingAmt > 0) {
        const userledger = await Ledger.findById(userId);
        userledger.withdrawalDisabled = false;
        userledger.pendingWithdrawal = null;
        log(
          `pendingAmt value ${pendingAmt}> Needs to be adjusted ${lg.uhid} `,
          true
        );
        // await userledger.save(); // Uncomment to persist
      }

      let verdict;
      if (diff > TOL && Math.abs(diff - pendingAmt) < TOL) {
        console.log(`Inside process`);
        verdict = "NEEDS_REFUND";
        needsRefund++;
        if (!isDryRun) {
          try {
            const ledgerDoc = await Ledger.findById(userId);
            if (ledgerDoc) {
              const refundDecimal = mongoose.Types.Decimal128.fromString(
                pendingAmt.toString()
              );
              ledgerDoc.wallets.lp = addDecimal128(
                ledgerDoc.wallets.lp || "0.0",
                refundDecimal
              );
              ledgerDoc.withdrawalDisabled = false;
              ledgerDoc.pendingWithdrawal = undefined;
              await ledgerDoc.save();
              refundsProcessed++;
              console.log(
                `Refunded ${pendingAmt.toFixed(6)} XRP to user ${
                  ledgerDoc.uhid || userId
                }`
              );
            }
          } catch (refundErr) {
            console.error("Failed to process refund for", userId, refundErr);
          }
        } else {
          refundsProcessed++;
          console.log(
            `[DRY RUN] Would refund ${pendingAmt.toFixed(6)} XRP to user ${
              lg.uhid || userId
            }`
          );
        }
      } else {
        verdict = "ALREADY_PAID_OR_MISMATCH";
        const exactMatch = await Withdrawal.findOne({
          userId,
          amountXRP: pendingAmt,
        });

        if (exactMatch) {
          console.log("Withdrawal matched", exactMatch.amountXRP.toFixed(6));
          withdrawalsMatched++;
          if (!isDryRun) {
            try {
              const ledgerDoc = await Ledger.findById(userId);
              if (ledgerDoc) {
                ledgerDoc.withdrawalDisabled = false;
                ledgerDoc.pendingWithdrawal = undefined;
                await ledgerDoc.save();
                console.log(
                  `Released withdrawal lock for user ${
                    ledgerDoc.uhid || userId
                  }`
                );
              }
            } catch (releaseErr) {
              console.error(
                "Failed to release withdrawal lock for",
                userId,
                releaseErr
              );
            }
          } else {
            console.log(
              `[DRY RUN] Would release withdrawal lock for user ${
                lg.uhid || userId
              }`
            );
          }
        } else {
          const withdrawalsList = await Withdrawal.find({ userId }).lean();
          console.log(`Pending withdrawal: ${pendingAmt.toFixed(6)}`);

          const totalWithdrawals = withdrawalsList.reduce((sum, w) => {
            console.log(`Withdrawal: ${w.amountXRP.toFixed(6)}`);
            return sum + d2n(w.amountXRP);
          }, 0);
          console.log(`Total withdrawals: ${totalWithdrawals.toFixed(6)}`);
          unMatchedWithdrawals[userId] = { pendingAmt: withdrawalsList };
        }
        alreadyPaid++;
      }

      if (verdict === "ALREADY_PAID_OR_MISMATCH") {
        console.log(
          `AR=${communityRewards.toFixed(6)} | lp=${lp.toFixed(6)} | ` +
            `expectedLP=${expectedLP.toFixed(6)} | diff=${diff.toFixed(6)} | ` +
            `pending=${pendingAmt.toFixed(6)} | ${verdict}`
        );
      }
    }

    console.log("\nSUMMARY:");
    console.log(`  Ledgers needing refund : ${needsRefund}`);
    console.log(`  Already paid / mismatch : ${alreadyPaid}`);
    console.log(`  Withdrawals matched : ${withdrawalsMatched}`);
    console.log(
      `  Refunds processed (dry-run=${isDryRun}) : ${refundsProcessed}`
    );
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
