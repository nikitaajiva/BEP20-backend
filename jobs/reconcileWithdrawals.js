const LedgerRow = require("../models/LedgerRow");
const Ledger = require("../models/Ledger");
const { addDecimal128 } = require("../utils/decimal128Utils");
const { REFUND_WINDOW_MS } = require("../config/constants/timings");
const { BSC_CONFIRMATIONS, getProvider } = require("../utils/bsc");

/**
 * Scan for INITIATED withdrawals and attempt to verify their on-chain status.
 * If the transaction hash is confirmed we mark the row as COMPLETED.
 * If nothing is found after X minutes we mark as FAILED
 * so that a manual refund script can credit the user.
 */


async function reconcileWithdrawals() {
  // Consider INITIATED rows older than the refund window (5 min by default)
  const cutoff = new Date(Date.now() - REFUND_WINDOW_MS);
  const pendingRows = await LedgerRow.find({ status: 'INITIATED', ts: { $lte: cutoff } });

  if (!pendingRows.length) return;

  const provider = getProvider();

  for (const row of pendingRows) {
    try {
      let succeeded = false;
      if (row.refId) {
        const receipt = await provider.getTransactionReceipt(row.refId);
        if (receipt && receipt.status === 1) {
          const confirmations = (await provider.getBlockNumber()) - receipt.blockNumber + 1;
          if (confirmations >= BSC_CONFIRMATIONS) {
            row.status = "COMPLETED";
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
        }
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
                  ledger.wallets.bnb = addDecimal128(ledger.wallets.bnb || '0.0', amt);
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

}

module.exports = reconcileWithdrawals; 
