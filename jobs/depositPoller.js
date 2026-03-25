const xrpl = require('xrpl');
const cron = require('node-cron');
const User = require('../models/User');
const { processXrpTransaction, getXrplClient } = require('../services/depositService');
const PollerState = require('../models/PollerState');

const SYSTEM_DEPOSIT_WALLET = process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS;
const POLLER_STATE_KEY = 'xrpDepositPoller';

let isPolling = false; // Simple lock to prevent concurrent runs

async function pollXrpDeposits() {
    if (isPolling) {
        console.log('XRP deposit poller is already running. Skipping this cycle.');
        return;
    }
    isPolling = true;
    console.log('Starting XRP deposit poller cycle...');

    let client;
    try {
        client = await getXrplClient();

        // Get the last processed ledger index from the database
        let pollerState = await PollerState.findById(POLLER_STATE_KEY);
        let lastLedgerIndex = pollerState ? pollerState.lastProcessedLedger : -1; // Default to -1 if not set
        let maxLedgerInBatch = lastLedgerIndex;

        const response = await client.request({
            command: 'account_tx',
            account: SYSTEM_DEPOSIT_WALLET,
            ledger_index_min: lastLedgerIndex,
            ledger_index_max: -1,
            limit: 100, // Process up to 100 transactions per cycle
            forward: true // Process in chronological order
        });
        
        const transactions = response.result.transactions;

        if (transactions.length > 0) {
            console.log(`Found ${transactions.length} new transactions to process.`);
        }

        for (const tx of transactions) {
            // The `tx` object from account_tx has `validated`, `tx_json`, `hash`, etc., at the top level.
            if (!tx.validated) {
                console.warn('[POLLER_DEBUG] Found a non-validated transaction, skipping.', tx);
                continue;
            }

            // Update the max ledger index seen in this batch
            if (tx.ledger_index && tx.ledger_index > maxLedgerInBatch) {
                maxLedgerInBatch = tx.ledger_index;
            }

            // The transaction details are in the 'tx_json' field for account_tx results
            const txDetails = tx.tx_json;
            if (!txDetails) {
                console.warn('[POLLER_DEBUG] Transaction object missing tx_json field, skipping.', tx);
                continue;
            }

            if (tx.validated && txDetails.TransactionType === 'Payment' && txDetails.Destination === SYSTEM_DEPOSIT_WALLET) {
                const transactionId = tx.hash; // Hash is at the top level
                const senderXrpAddress = txDetails.Account; // Account is inside tx_json

                if (!transactionId || !senderXrpAddress) {
                    console.warn('[POLLER_DEBUG] Transaction object missing hash or Account, skipping.', tx);
                    continue;
                }
                
                console.log(`[POLLER_DEBUG] Processing transaction ${transactionId} from ${senderXrpAddress}`);

                // Use the centralized service to process the deposit
                const result = await processXrpTransaction(transactionId, senderXrpAddress);
                
                // --- Start of Poller Debug Logging ---
                console.log(`[POLLER_DEBUG] Result for tx ${transactionId}: ${JSON.stringify(result, null, 2)}`);
                // --- End of Poller Debug Logging ---

                switch (result.status) {
                    case 'completed':
                        console.log(`[POLLER_SUCCESS] Successfully processed and credited deposit for tx: ${transactionId}`);
                        break;
                    case 'duplicate':
                        // This is expected if the API processed it first, so no error log needed.
                        break;
                    case 'no_user':
                        console.warn(`[POLLER_SKIP] Skipping deposit: ${result.message} (tx: ${transactionId})`);
                        break;
                    default:
                        console.error(`[POLLER_FAIL] Failed to process deposit for tx: ${transactionId}. Reason: ${result.message}`);
                        break;
                }
            }
        }

        // Save the highest ledger index processed in this batch, if it has increased.
        if (maxLedgerInBatch > lastLedgerIndex) {
            await PollerState.findByIdAndUpdate(
                POLLER_STATE_KEY,
                { lastProcessedLedger: maxLedgerInBatch },
                { upsert: true, new: true }
            );
        }

    } catch (error) {
        console.error('Error during XRP deposit polling:', error);
    } finally {
        if (client && client.isConnected()) {
            await client.disconnect();
        }
        isPolling = false;
        console.log('XRP deposit poller cycle finished.');
    }
}

// Schedule the poller to run every 2 minutes.
// The cron string '*/2 * * * *' means "at every 2nd minute".
function start() {
    console.log('XRP Deposit Poller scheduled to run every 2 minutes.');
    cron.schedule('* * * * *', pollXrpDeposits);
}

module.exports = { start }; 
