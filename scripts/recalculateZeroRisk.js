/*
  Recalculate Zero-Risk Balances
  ------------------------------
  For every user that currently has LP balance > 0 (wallets.lp in Ledger),
  compute:
      totalDeposits   = Σ(chain deposits.amountXRP)
      totalWithdrawals= Σ(chain withdrawals.amountXRP)

  Then update wallets.zeroRisk in the Ledger document to
      totalDeposits - totalWithdrawals

  Usage:
      node backend/scripts/recalculateZeroRisk.js

  The script re-uses the ChainDeposit / ChainWithdrawal collections filled by
  trackChainTx.js, so make sure that script has been run recently.
*/

require('dotenv').config();
const mongoose   = require('mongoose');
const connectDB  = require('../config/db');
const Ledger     = require('../models/Ledger');

// Minimal schemas for chain deposits / withdrawals (mirrors trackChainTx.js)
const { Schema } = mongoose;
const txFields = {
  txHash:      String,
  userId:      { type: Schema.Types.ObjectId, ref: 'User' },
  amountXRP:   Number,
};

const Deposit    = mongoose.model('ChainDeposit',    new Schema(txFields), 'cDeposits');
const Withdrawal = mongoose.model('ChainWithdrawal', new Schema(txFields), 'cWithdrawals');

(async function main() {
  try {
    await connectDB();

    const lpPositive = await Ledger.find(
      { 'wallets.lp': { $gt: mongoose.Types.Decimal128.fromString('0') } },
      { _id: 1, userId: 1, uhid: 1 }
    ).lean();

    console.log(`→ Processing ${lpPositive.length} ledgers with LP > 0`);

    for (const led of lpPositive) {
      const uid = led.userId || led._id; // _id is same as userId per schema

      const [dep] = await Deposit.aggregate([
        { $match: { userId: uid } },
        { $group: { _id: null, total: { $sum: '$amountXRP' } } },
      ]);
      const totalDeposits = dep?.total || 0;

      const [wit] = await Withdrawal.aggregate([
        { $match: { userId: uid } },
        { $group: { _id: null, total: { $sum: '$amountXRP' } } },
      ]);
      const totalWithdrawals = wit?.total || 0;

      const newZeroRisk = totalDeposits - totalWithdrawals;
      await Ledger.updateOne(
        { _id: uid },
        { $set: { 'wallets.zeroRisk': mongoose.Types.Decimal128.fromString(newZeroRisk.toFixed(6)) } }
      );

      console.log(
        `${led.uhid || uid}: deposits=${totalDeposits.toFixed(6)}, withdrawals=${totalWithdrawals.toFixed(6)} → zeroRisk=${newZeroRisk.toFixed(6)}`
      );
    }

    console.log('✅  Zero-Risk balances updated.');
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})(); 