const cron = require("node-cron");
const { verifyDepositIntent } = require("../services/depositService");
const PollerState = require("../models/PollerState");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");

const POLLER_STATE_KEY = "usdtDepositPoller";

let isPolling = false; // Simple lock to prevent concurrent runs

async function pollUsdtDeposits() {
    if (isPolling) {
        console.log("USDT deposit poller is already running. Skipping this cycle.");
        return;
    }
    isPolling = true;
    console.log("Starting deposit poller cycle...");

    try {
        let pollerState = await PollerState.findById(POLLER_STATE_KEY);

        const lastProcessedBlock = pollerState ? pollerState.lastProcessedLedger : null;
        const pendingIntents = await UsdtDepositIntent.find({
          status: "pending",
          expiresAt: { $gt: new Date() },
        }).sort({ createdAt: 1 });

        if (pendingIntents.length > 0) {
          console.log(`Found ${pendingIntents.length} pending deposit intents to verify.`);
        }

        for (const intent of pendingIntents) {
          const result = await verifyDepositIntent(intent);
          if (result.success) {
            console.log(`[POLLER_SUCCESS] Deposit completed for intent ${intent.referenceId}`);
          }
        }

        await PollerState.findByIdAndUpdate(
          POLLER_STATE_KEY,
          { lastProcessedLedger: lastProcessedBlock ?? 0 },
          { upsert: true, new: true }
        );

    } catch (error) {
        console.error("Error during deposit polling:", error);
    } finally {
        isPolling = false;
        console.log("Deposit poller cycle finished.");
    }
}

// Schedule the poller to run every 2 minutes.
// The cron string '*/2 * * * *' means "at every 2nd minute".
function start() {
    console.log("Deposit poller scheduled to run every 2 minutes.");
    cron.schedule("* * * * *", pollUsdtDeposits);
}

module.exports = { start }; 
