const xrpl = require('xrpl');
const LedgerRow = require('../models/LedgerRow');
const xrpTransactions = require('../utils/xrpTransactions');
const Ledger = require('../models/Ledger');
const { addDecimal128 } = require('../utils/decimal128Utils');
const { REFUND_WINDOW_MS } = require('../config/constants/timings');

/**
 * Scan for INITIATED withdrawals and attempt to verify their on-chain status.
 * If the transaction with matching memo is found we mark the row as COMPLETED
 * (and store the tx hash). If nothing is found after X minutes we mark as FAILED
 * so that a manual refund script can credit the user.
 */


async function reconcileWithdrawals() {
  // Consider INITIATED rows older than the refund window (5 min by default)
  const cutoff = new Date(Date.now() - REFUND_WINDOW_MS);
  const pendingRows = await LedgerRow.find({ status: 'INITIATED', ts: { $lte: cutoff } });

  if (!pendingRows.length) return;

  const client = new xrpl.Client(process.env.XRP_LEDGER_SERVER_URL || 'wss://xrplcluster.com');
  await client.connect();

  for (const row of pendingRows) {
    try {
      const response = await client.request({
        command: 'account_tx',
        account: process.env.SYSTEM_WITHDRAWAL_ADDRESS,
        ledger_index_min: -1500, // recent ledgers only
        ledger_index_max: -1,
        binary: false,
        limit: 200,
      });

      const match = response.result?.transactions?.find(tx => {
        const memos = tx.tx?.Memos || [];
        return memos.some(m => Buffer.from(m.Memo?.MemoData, 'hex').toString('utf8') === row.uniqueTransactionId);
      });

      let succeeded = false;
      if (match && match.validated && match.meta?.TransactionResult === 'tesSUCCESS') {
        row.status = 'COMPLETED';
        row.refId = match.hash;
        await row.save();

        // Re-enable withdrawals for this user
        try {
          const ledger = await Ledger.findOne({ userId: row.userId });
          if (ledger && ledger.withdrawalDisabled) {
            ledger.withdrawalDisabled = false;
            await ledger.save();
          }
        } catch (e) {
          console.error('Failed to clear withdrawalDisabled after completion:', e);
        }

        succeeded = true;
      }

      // --------------------------------------------------------------
      // Auto-refund logic: if no on-chain tx & age ≥ REFUND_WINDOW_MS
      // --------------------------------------------------------------
      if (!succeeded) {
        const rowAgeMs = Date.now() - new Date(row.ts).getTime();
        if (rowAgeMs >= REFUND_WINDOW_MS) {
          try {
            const ledger = await Ledger.findOne({ userId: row.userId });
            if (ledger) {
              const amt = row.amount; // Decimal128
              switch (row.walletFrom) {
                case 'LP':
                  ledger.wallets.lp = addDecimal128(ledger.wallets.lp || '0.0', amt);
                  break;
                case 'COMMUNITY_REWARDS':
                  ledger.wallets.communityRewards = addDecimal128(ledger.wallets.communityRewards || '0.0', amt);
                  break;
                case 'ZERO_RISK':
                default:
                  ledger.wallets.xaman = addDecimal128(ledger.wallets.xaman || '0.0', amt);
                  break;
              }
              ledger.withdrawalDisabled = false; // clear flag upon refund
              await ledger.save();
            }

            row.status = 'REFUNDED';
            row.refundedAt = new Date();
            row.narrative = (row.narrative || '') + ' | Auto-refunded after no on-chain tx';
            await row.save();
          } catch (refundErr) {
            // Fail silently; job will retry
          }
        }
      }
    } catch (_) {
      // Log & continue – we will retry next run
    }
  }

  try { await client.disconnect(); } catch (_) {}
}

module.exports = reconcileWithdrawals; 