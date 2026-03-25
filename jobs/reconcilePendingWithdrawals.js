const xrpl = require('xrpl');
const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const { REFUND_WINDOW_MS } = require('../config/refundConstants');
const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  ensureDecimal128,
} = require('../utils/decimal128Utils');

// XRPL connection params
const XRP_LEDGER_SERVER_URL = process.env.XRP_LEDGER_SERVER_URL ||
  'wss://s1.ripple.com';
const SYSTEM_WITHDRAWAL_ADDRESS = process.env.SYSTEM_WITHDRAWAL_ADDRESS;

if (!SYSTEM_WITHDRAWAL_ADDRESS) {
  throw new Error('SYSTEM_WITHDRAWAL_ADDRESS env variable is required');
}

// Helper to query XRPL for payment with matching memo
async function findPaymentByMemo(client, memoText) {
  const response = await client.request({
    command: 'account_tx',
    account: SYSTEM_WITHDRAWAL_ADDRESS,
    binary: false,
    forward: false,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: 200,
  });

  const txs = response.result?.transactions || [];
  for (const item of txs) {
    const { tx } = item;
    if (tx.TransactionType !== 'Payment' || !Array.isArray(tx.Memos)) continue;
    const memo = tx.Memos.find((m) => {
      try {
        const memoType = Buffer.from(m.Memo.MemoType, 'hex').toString();
        if (memoType !== 'uniqueId') return false;
        const memoData = Buffer.from(m.Memo.MemoData, 'hex').toString();
        return memoData === memoText;
      } catch (_) {
        return false;
      }
    });
    if (memo) {
      return item; // full tx object
    }
  }
  return null;
}

async function processLedger(client, ledgerDoc) {
  const pending = ledgerDoc.pendingWithdrawal;
  if (!pending || !pending.idempotencyKey) return;

  // Try to find the on-chain payment using the memo
  let txFound = null;
  try {
    txFound = await findPaymentByMemo(client, pending.idempotencyKey);
  } catch (err) {
    console.error('XRPL lookup failed:', err.message);
  }

  if (txFound) {
    // Mark the INITIATED LedgerRow as COMPLETED
    const row = await LedgerRow.findOne({
      userId: ledgerDoc._id,
      uniqueTransactionId: pending.idempotencyKey,
      status: 'INITIATED',
    });
    if (row) {
      row.status = 'COMPLETED';
      row.refId = txFound.tx.hash;
      await row.save();
    }

    // Clear pending & enable withdrawals
    ledgerDoc.pendingWithdrawal = undefined;
    ledgerDoc.withdrawalDisabled = false;
    ledgerDoc.markModified('pendingWithdrawal');
    await ledgerDoc.save();
    return;
  }

  // Not found – maybe refund?
  const ageMs = Date.now() - new Date(pending.timestamp || ledgerDoc.updatedAt).getTime();
  if (ageMs < REFUND_WINDOW_MS) {
    // Update lastChecked for observability
    ledgerDoc.pendingWithdrawal.lastChecked = new Date();
    ledgerDoc.markModified('pendingWithdrawal');
    await ledgerDoc.save();
    return;
  }

  // --------------------------------------
  // Refund path
  // --------------------------------------
  // Credit back wallets exactly as deducted
  ledgerDoc.wallets.xaman = addDecimal128(ensureDecimal128(ledgerDoc.wallets.xaman), pending.amountFromXaman);
  ledgerDoc.wallets.lp = addDecimal128(ensureDecimal128(ledgerDoc.wallets.lp), pending.amountFromLp);
  ledgerDoc.wallets.communityRewards = addDecimal128(ensureDecimal128(ledgerDoc.wallets.communityRewards), pending.amountFromRewards);
  ledgerDoc.wallets.zeroRisk = addDecimal128(ensureDecimal128(ledgerDoc.wallets.zeroRisk), pending.zeroRisk);
  ledgerDoc.wallets.airdrop = addDecimal128(ensureDecimal128(ledgerDoc.wallets.airdrop), pending.airdrop);

  // Insert a REFUND row
  await LedgerRow.create({
    userId: ledgerDoc._id,
    eventType: 'WITHDRAWAL_REFUND',
    walletFrom: 'SYSTEM',
    walletTo: 'USER',
    amount: ensureDecimal128(pending.zeroRisk),
    uniqueTransactionId: pending.idempotencyKey,
    status: 'COMPLETED',
    narrative: 'Withdrawal refunded – payment not found on-chain within refund window',
  });

  // Reset flags
  ledgerDoc.pendingWithdrawal = undefined;
  ledgerDoc.withdrawalDisabled = false;
  ledgerDoc.markModified('pendingWithdrawal');
  await ledgerDoc.save();
}

// ---------------- Public cron start / stop ----------------
let timerId = null;
let client = null;

async function tick() {
  try {
    if (!client) {
      client = new xrpl.Client(XRP_LEDGER_SERVER_URL);
      await client.connect();
    }

    const ledgers = await Ledger.find({ withdrawalDisabled: true, 'pendingWithdrawal.idempotencyKey': { $exists: true } }).limit(50);
    for (const ledgerDoc of ledgers) {
      await processLedger(client, ledgerDoc);
    }
  } catch (err) {
    console.error('[Reconciler] Tick error:', err);
  }
}

function start() {
  if (timerId) return; // already running
  timerId = setInterval(tick, 60 * 1000); // every minute
  console.log('ReconcilePendingWithdrawals job scheduled (every 60s)');
}

function stop() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  if (client && client.isConnected()) client.disconnect();
}

module.exports = { start, stop }; 