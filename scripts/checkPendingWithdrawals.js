/*
  Update LedgerRows for pendingWithdrawals
  ----------------------------------------
  Usage:
    # Single user by UHID
    node scripts/updateLedgerRow.js <UHID>

    # All users with withdrawalDisabled:true + pendingWithdrawal
    node scripts/updateLedgerRow.js
*/

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const connectDB = require('../config/db');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const User = require('../models/User');

const XRPL_RPC_URL = process.env.XRPL_RPC_URL ||
  'https://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7';

const MAX_TX_PER_ACCOUNT = 200;
const OUR_WITHDRAWAL_SOURCES = [
  'rfi4T2eHcjH4tTkJZ7izMu3TQFbckqY84M',
  'raEjhzmvKmmRpPxTxKPrVte66PAF7WVLt6',
  'rE6o6cmu39zfrYp47vp1MuTBWwvGU7mXe9',
  'rBJkbrYpUB9vhn5UhzaEFmcNwX8ho2nwi8',
  'rJhNaxHJyvSnzMoR5dY9iDmfAFJ8MgHoAR'
];

// ---- NEW: log file helpers ----
function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}
function logLine(filepath, obj) {
  fs.appendFileSync(filepath, JSON.stringify(obj) + '\n', 'utf8');
}

// ---- NEW: 1 minute check ----
function isOldEnough(ts, minutes = 1) {
  if (!ts) return false;
  const t = new Date(ts);
  return Date.now() - t.getTime() >= minutes * 60 * 1000;
}

function rippleTimeToDate(rippleSeconds) {
  return new Date((rippleSeconds + 946684800) * 1000);
}
function sameDay(d1, d2) {
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth() === d2.getUTCMonth() &&
         d1.getUTCDate() === d2.getUTCDate();
}

async function fetchAccountTx(address) {
  let marker = null;
  const allTx = [];

  do {
    const body = {
      method: 'account_tx',
      params: [{
        account: address,
        binary: false,
        forward: false,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: MAX_TX_PER_ACCOUNT,
        ...(marker ? { marker } : {})
      }],
    };

    const { data } = await axios.post(XRPL_RPC_URL, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    if (data.error) throw new Error(data.error);
    const result = data.result;
    if (!result || !result.transactions) break;

    allTx.push(...result.transactions);
    marker = result.marker || null;
  } while (marker);

  return allTx;
}

async function processLedger(ledger, logFile) {
  const userId = ledger.userId._id;
  const userXrpAddress = ledger.userId?.xrpAddress || '';
  const username = ledger.userId?.username || '';

  const pendingList = Array.isArray(ledger.pendingWithdrawal)
    ? ledger.pendingWithdrawal
    : [ledger.pendingWithdrawal];

  

  const txs = await fetchAccountTx(userXrpAddress);

  for (const pw of pendingList) {
    const uniqueTxId = pw?.uniqueTransactionId;
    if (!uniqueTxId) {
      
      logLine(logFile, { ts: new Date().toISOString(), userId, uhid: ledger.uhid, status: 'skipped', reason: 'no uniqueTransactionId' });
      continue;
    }

    if (!isOldEnough(pw.timestamp, 1)) {
      
      logLine(logFile, { ts: new Date().toISOString(), userId, uhid: ledger.uhid, uniqueTransactionId: uniqueTxId, status: 'skipped', reason: 'younger_than_1m' });
      continue;
    }

    const pwAmount = Number(pw.amountFromRewards || pw.zeroRisk || pw.amount || 0);
    const pwDate = pw.timestamp ? new Date(pw.timestamp) : null;

    const match = txs.find(t => {
      const tx = t.tx;
      if (!tx || tx.TransactionType !== 'Payment') return false;

      const delivered = t.meta?.delivered_amount || tx.Amount;
      let amountXrp = 0;
      if (typeof delivered === 'string') {
        amountXrp = Number(delivered) / 1_000_000;
      } else if (typeof delivered === 'object' && delivered.currency === 'XRP') {
        amountXrp = Number(delivered.value);
      }

      const txDate = rippleTimeToDate(tx.date);

      return (
        amountXrp > 0 &&
        Math.abs(amountXrp - pwAmount) < 0.0001 &&
        pwDate && sameDay(txDate, pwDate) &&
        OUR_WITHDRAWAL_SOURCES.includes(tx.Account)
      );
    });

    if (!match) {
      
      logLine(logFile, { ts: new Date().toISOString(), userId, uhid: ledger.uhid, uniqueTransactionId: uniqueTxId, status: 'not_found' });
      continue;
    }

    const tx = match.tx;
    const txHash = tx.hash;
    

    const result = await LedgerRow.updateOne(
      { uniqueTransactionId: uniqueTxId },
      {
        $set: {
          narrative: `Withdrawal initiated to ${userXrpAddress}`,
          status: 'COMPLETED',
          refId: txHash,
        },
      }
    );

    if (result.matchedCount === 0) {
      
      logLine(logFile, { ts: new Date().toISOString(), userId, uhid: ledger.uhid, uniqueTransactionId: uniqueTxId, status: 'ledgerrow_missing' });
    } else {
      
      logLine(logFile, { ts: new Date().toISOString(), userId, uhid: ledger.uhid, uniqueTransactionId: uniqueTxId, txHash, status: 'completed' });
    }
  }

  await Ledger.updateOne(
    { _id: ledger._id },
    { $set: { pendingWithdrawal: null, withdrawalDisabled: false } }
  );

  
}

(async function main() {
  try {
    await connectDB();

    const logDir = path.resolve(__dirname, '../logs');
    ensureDir(logDir);
    const dailyLog = path.join(logDir, `ledgerrow-update-${new Date().toISOString().slice(0,10)}.log`);

    const targetUhid = process.argv[2];
    let ledgers;

    if (targetUhid) {
      
      ledgers = await Ledger.find({ uhid: targetUhid, pendingWithdrawal: { $exists: true } })
        .populate('userId', 'xrpAddress username email');
    } else {
      
      ledgers = await Ledger.find({ withdrawalDisabled: true, pendingWithdrawal: { $exists: true, $ne: null } })
        .populate('userId', 'xrpAddress username email');
    }

    if (!ledgers.length) {
      
      process.exit(0);
    }

    for (const ledger of ledgers) {
      await processLedger(ledger, dailyLog);
    }

    
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
