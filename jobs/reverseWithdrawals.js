const LedgerRow = require('../models/LedgerRow');
const Ledger = require('../models/Ledger');
const { subtractDecimal128 } = require('../utils/decimal128Utils');

/**
 * Simple reversal job for reconcileWithdrawals.js.
 *
 * For every LedgerRow currently marked as REFUNDED, we:
 *   • set status back to INITIATED
 *   • clear refId / refundedAt where applicable
 *   • remove refund credit from user wallet if status was REFUNDED
 *
 * No attempt is made to restore withdrawalDisabled flags; safer to leave as-is.
 */

async function reverseWithdrawals() {
  const rows = await LedgerRow.find({ status: 'REFUNDED' });
  if (!rows.length) {
    console.log('No REFUNDED withdrawals found – nothing to reverse.');
    return;
  }

  console.log(`Reversing ${rows.length} rows…`);

  let processed = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const previousStatus = row.status;
      row.status = 'INITIATED';

      if (previousStatus === 'REFUNDED') {
        // Undo wallet credit
        const ledger = await Ledger.findOne({ userId: row.userId });
        if (ledger) {
          const amt = row.amount; // Decimal128
          switch (row.walletFrom) {
            case 'LP':
              ledger.wallets.lp = subtractDecimal128(ledger.wallets.lp || '0.0', amt);
              break;
            case 'COMMUNITY_REWARDS':
              ledger.wallets.communityRewards = subtractDecimal128(ledger.wallets.communityRewards || '0.0', amt);
              break;
            case 'ZERO_RISK':
            default:
              ledger.wallets.usdt = subtractDecimal128(ledger.wallets.usdt || '0.0', amt);
              break;
          }
          await ledger.save();
        }

        // Clear refund-specific fields
        row.refundedAt = undefined;
        if (row.narrative && row.narrative.includes('Auto-refunded after no on-chain tx')) {
          row.narrative = row.narrative.replace(/\s*\|\s*Auto-refunded after no on-chain tx/, '');
        }
      }

      await row.save();
      processed += 1;
      if (processed % 50 === 0) console.log(`Processed ${processed}/${rows.length}`);
    } catch (err) {
      errors += 1;
      console.error('Failed to reverse row', row._id, err);
    }
  }

  console.log(`Reversal complete. Success: ${processed}, Errors: ${errors}`);
}

module.exports = reverseWithdrawals; 

