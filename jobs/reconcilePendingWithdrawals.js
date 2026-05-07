const mongoose = require("mongoose");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const { REFUND_WINDOW_MS } = require("../config/refundConstants");
const { addDecimal128, ensureDecimal128 } = require("../utils/decimal128Utils");
const { BSC_CONFIRMATIONS, getProvider } = require("../utils/bsc");

async function processLedger(provider, ledgerDoc) {
  const pending = ledgerDoc.pendingWithdrawal;
  if (!pending || !pending.idempotencyKey) return;

  const row = await LedgerRow.findOne({
    userId: ledgerDoc._id,
    uniqueTransactionId: pending.idempotencyKey,
    status: "INITIATED",
  });

  const txHash = row?.refId;
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt && receipt.status === 1) {
      const confirmations = (await provider.getBlockNumber()) - receipt.blockNumber + 1;
      if (confirmations >= BSC_CONFIRMATIONS) {
    // Mark the INITIATED LedgerRow as COMPLETED
        row.status = "COMPLETED";
        await row.save();

    // Clear pending & enable withdrawals
    ledgerDoc.pendingWithdrawal = undefined;
    ledgerDoc.withdrawalDisabled = false;
    ledgerDoc.markModified('pendingWithdrawal');
    await ledgerDoc.save();
    return;
      }
    }
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
  ledgerDoc.wallets.bnb = addDecimal128(ensureDecimal128(ledgerDoc.wallets.bnb), pending.amountFromUsdt);
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
let provider = null;

async function tick() {
  try {
    if (!provider) {
      provider = getProvider();
    }

    const ledgers = await Ledger.find({ withdrawalDisabled: true, 'pendingWithdrawal.idempotencyKey': { $exists: true } }).limit(50);
    for (const ledgerDoc of ledgers) {
      await processLedger(provider, ledgerDoc);
    }
  } catch (err) {
    console.error('[Reconciler] Tick error:', err);
  }
}

function start() {
  if (timerId) return; // already running
  timerId = setInterval(tick, 60 * 1000); // every minute
  
}

function stop() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  provider = null;
}

module.exports = { start, stop }; 
