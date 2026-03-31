const cron = require("node-cron");
const { verifyDepositIntent } = require("../services/depositService");
const PollerState = require("../models/PollerState");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");

const POLLER_STATE_KEY = "usdtDepositPoller";

let isPolling = false; // Simple lock to prevent concurrent runs

async function pollUsdtDeposits() {
    if (isPolling) {
        
        return;
    }
    isPolling = true;
    

    try {
        let pollerState = await PollerState.findById(POLLER_STATE_KEY);

        const lastProcessedBlock = pollerState ? pollerState.lastProcessedLedger : null;
        const now = new Date();
        await UsdtDepositIntent.updateMany(
          { status: "pending", expiresAt: { $lte: now } },
          { status: "expired" }
        );

        const pendingIntents = await UsdtDepositIntent.find({
          status: "pending",
          expiresAt: { $gt: now },
          tx_hash: { $exists: true, $ne: "" },
        }).sort({ createdAt: 1 });

        if (pendingIntents.length > 0) {
          
        }

        for (const intent of pendingIntents) {
          const result = await verifyDepositIntent(intent);
          if (result.success) {
            
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
        
    }
}

// Schedule the poller to run every 2 minutes.
// The cron string '*/2 * * * *' means "at every 2nd minute".
function start() {
    
    cron.schedule("* * * * *", pollUsdtDeposits);
}

module.exports = { start }; 
