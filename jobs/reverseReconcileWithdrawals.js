const LedgerRow = require('../models/LedgerRow');
const Ledger = require('../models/Ledger');
const { subtractDecimal128 } = require('../utils/decimal128Utils');

/**
 * Reverse the impact of reconcileWithdrawals.js script
 * This script will:
 * 1. Find all LedgerRows that were changed to COMPLETED or REFUNDED
 * 2. Revert them back to INITIATED status
 * 3. Undo wallet balance adjustments for REFUNDED transactions
 * 4. Log all changes to a separate collection for audit
 */

// Collection to store reversal audit logs
const mongoose = require('mongoose');
const reversalLogSchema = new mongoose.Schema({
  action: String,
  documentType: String, // 'LedgerRow' or 'Ledger'
  documentId: mongoose.Schema.Types.ObjectId,
  userId: String,
  beforeState: Object,
  afterState: Object,
  timestamp: { type: Date, default: Date.now },
  scriptRun: String
});

const ReversalLog = mongoose.model('ReversalLog', reversalLogSchema);

async function reverseReconcileWithdrawals() {
  const scriptRunId = new Date().toISOString();
  console.log(`Starting reversal process - Run ID: ${scriptRunId}`);

  try {
    // Find all LedgerRows that were likely affected by the reconciliation script
    // Look for COMPLETED or REFUNDED rows that might have been changed recently
    const affectedRows = await LedgerRow.find({
      $or: [
        { status: 'COMPLETED' },
        { status: 'REFUNDED' }
      ]
    });

    console.log(`Found ${affectedRows.length} potentially affected LedgerRows`);

    let processedCount = 0;
    let errorCount = 0;

    for (const row of affectedRows) {
      try {
        // Log the before state
        const beforeState = {
          status: row.status,
          refId: row.refId,
          refundedAt: row.refundedAt,
          narrative: row.narrative
        };

        // Revert to INITIATED status
        const originalStatus = row.status;
        row.status = 'INITIATED';
        
        // Clear fields that were set by reconciliation
        if (row.refId) {
          row.refId = undefined;
        }
        if (row.refundedAt) {
          row.refundedAt = undefined;
        }
        
        // Clean up narrative if it was modified by auto-refund
        if (row.narrative && row.narrative.includes('Auto-refunded after no on-chain tx')) {
          row.narrative = row.narrative.replace(/\s*\|\s*Auto-refunded after no on-chain tx/, '');
        }

        await row.save();

        // Log the change
        await new ReversalLog({
          action: 'REVERT_LEDGER_ROW',
          documentType: 'LedgerRow',
          documentId: row._id,
          userId: row.userId,
          beforeState,
          afterState: {
            status: row.status,
            refId: row.refId,
            refundedAt: row.refundedAt,
            narrative: row.narrative
          },
          scriptRun: scriptRunId
        }).save();

        // If this was a REFUNDED transaction, we need to reverse the wallet balance adjustment
        if (originalStatus === 'REFUNDED') {
          const ledger = await Ledger.findOne({ userId: row.userId });
          if (ledger) {
            const beforeLedgerState = {
              wallets: JSON.parse(JSON.stringify(ledger.wallets)),
              withdrawalDisabled: ledger.withdrawalDisabled
            };

            const amt = row.amount; // Decimal128
            
            // Subtract the amount that was refunded back to the appropriate wallet
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

            // Note: We don't restore withdrawalDisabled to true because we don't know its original state
            // and it's safer to leave withdrawals enabled

            await ledger.save();

            // Log the ledger change
            await new ReversalLog({
              action: 'REVERSE_WALLET_REFUND',
              documentType: 'Ledger',
              documentId: ledger._id,
              userId: row.userId,
              beforeState: beforeLedgerState,
              afterState: {
                wallets: JSON.parse(JSON.stringify(ledger.wallets)),
                withdrawalDisabled: ledger.withdrawalDisabled
              },
              scriptRun: scriptRunId
            }).save();
          }
        }

        processedCount++;
        console.log(`Processed ${processedCount}/${affectedRows.length} - Reverted ${row.userId} from ${originalStatus} to INITIATED`);

      } catch (error) {
        errorCount++;
        console.error(`Error processing row ${row._id}:`, error);
        
        // Log the error
        await new ReversalLog({
          action: 'ERROR',
          documentType: 'LedgerRow',
          documentId: row._id,
          userId: row.userId,
          beforeState: { error: error.message },
          afterState: null,
          scriptRun: scriptRunId
        }).save();
      }
    }

    console.log(`Reversal complete - Run ID: ${scriptRunId}`);
    console.log(`Successfully processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total affected rows: ${affectedRows.length}`);

    // Create summary log
    await new ReversalLog({
      action: 'SUMMARY',
      documentType: 'Summary',
      documentId: null,
      userId: null,
      beforeState: null,
      afterState: {
        totalProcessed: processedCount,
        totalErrors: errorCount,
        totalAffected: affectedRows.length,
        scriptRunId
      },
      scriptRun: scriptRunId
    }).save();

  } catch (error) {
    console.error('Fatal error in reversal process:', error);
    throw error;
  }
}

module.exports = reverseReconcileWithdrawals;
