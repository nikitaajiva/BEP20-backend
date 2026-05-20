const { ethers } = require("ethers");
const { normalizeAddress } = require("../utils/bsc");
const { getWssProvider, getHttpProvider } = require("../config/blockchain");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");
const BnbTransaction = require("../models/BnbTransaction");
const PollerState = require("../models/PollerState");
const { processBnbTransaction } = require("./depositService");
const connectDB = require("../config/db");

const POLLER_STATE_KEY = "bscWatcher";

class BscWatcherService {
  constructor() {
    this.systemAddress = normalizeAddress(process.env.BSC_SYSTEM_DEPOSIT_ADDRESS);
    this.isWatching = false;
    this.lastProcessedBlock = 0;
    this.processingBlocks = new Set();
    this.blockPollIntervalMs = Number(
      process.env.BSC_WATCHER_POLL_MS || process.env.WATCHER_POLL_MS || 6000
    );
    this.blockPollTimer = null;
    this.listenerRetryTimer = null;
    this.activeProvider = null;
  }

  get provider() {
    return getWssProvider();
  }

  get httpProvider() {
    return getHttpProvider();
  }

  async start() {
    if (this.isWatching) return;
    this.isWatching = true;
    console.log("🚀 BSC Watcher Service started focusing on address:", this.systemAddress);

    // Sync blocks starting from lastProcessedBlock or last 50 blocks relative to current
    try {
      let pollerState = await PollerState.findById(POLLER_STATE_KEY);
      const currentBlock = await this.httpProvider.getBlockNumber();
      
      const lastPersistedBlock = pollerState ? pollerState.lastProcessedLedger : 0;
      const startBlock = lastPersistedBlock > 0 
        ? Math.max(lastPersistedBlock, currentBlock - 100) // Start from last persisted or at most 100 blocks back
        : currentBlock - 50; // Initial run fallback

      console.log(`📡 Current block is ${currentBlock}. Syncing from block ${startBlock}...`);
      
      for (let i = startBlock; i <= currentBlock; i++) {
        await this.processBlock(i, true);
      }
      if (currentBlock > this.lastProcessedBlock) {
        this.lastProcessedBlock = currentBlock;
      }
    } catch (error) {
      console.error("❌ Error during initial block sync:", error);
    }

    this.startPolling();
    this.setupListeners();
  }

  setupListeners() {
    if (!this.isWatching) return;

    const provider = this.provider;
    if (!provider) {
      console.warn("🔻 BSC watcher running in HTTP polling mode only.");
      return;
    }

    this.activeProvider = provider;

    // Subscribe to new blocks for real-time tracking (WSS)
    provider.on("block", async (blockNumber) => {
      try {
        await this.processBlock(blockNumber);
      } catch (error) {
        console.error(`❌ Error processing block ${blockNumber}:`, error);
      }
    });

    // Error handling with auto-recovery
    provider.on("error", (error) => {
      console.error("⚠️ WebSocket Provider Error, attempting to re-setup in 10s:", error);
      this.resetRealtimeListener(provider);
    });

    const socket = provider.websocket || provider._websocket || null;
    if (socket && typeof socket.on === "function") {
      socket.on("error", (error) => {
        console.error("⚠️ BSC watcher socket error. Falling back to polling:", error?.message || error);
        this.resetRealtimeListener(provider);
      });

      socket.on("close", (code, reason) => {
        console.warn(
          `⚠️ BSC watcher socket closed (${code}). Falling back to polling:${reason ? ` ${reason.toString()}` : ""}`
        );
        this.resetRealtimeListener(provider);
      });
    }
  }

  resetRealtimeListener(provider) {
    if (provider && typeof provider.removeAllListeners === "function") {
      provider.removeAllListeners("block");
      provider.removeAllListeners("error");
    }

    if (this.listenerRetryTimer) {
      clearTimeout(this.listenerRetryTimer);
    }

    this.listenerRetryTimer = setTimeout(() => {
      this.listenerRetryTimer = null;
      this.setupListeners();
    }, 10000);
  }

  startPolling() {
    if (this.blockPollTimer) return;

    const pollLatestBlocks = async () => {
      if (!this.isWatching) return;

      try {
        const currentBlock = await this.httpProvider.getBlockNumber();
        if (currentBlock <= this.lastProcessedBlock) return;

        for (let block = this.lastProcessedBlock + 1; block <= currentBlock; block += 1) {
          await this.processBlock(block);
        }
      } catch (error) {
        console.error("❌ Error while polling latest BSC blocks:", error);
      }
    };

    this.blockPollTimer = setInterval(() => {
      pollLatestBlocks().catch((error) => {
        console.error("❌ Unhandled BSC polling failure:", error);
      });
    }, this.blockPollIntervalMs);

    pollLatestBlocks().catch((error) => {
      console.error("❌ Initial BSC polling failure:", error);
    });
  }

  stop() {
    this.isWatching = false;

    if (this.blockPollTimer) {
      clearInterval(this.blockPollTimer);
      this.blockPollTimer = null;
    }

    if (this.listenerRetryTimer) {
      clearTimeout(this.listenerRetryTimer);
      this.listenerRetryTimer = null;
    }

    if (this.activeProvider && typeof this.activeProvider.removeAllListeners === "function") {
      this.activeProvider.removeAllListeners("block");
      this.activeProvider.removeAllListeners("error");
    }
  }

  async processBlock(blockNumber, isSyncing = false) {
    // Only skip if it's strictly older than what we're tracking, 
    // BUT during initial sync we want to be inclusive.
    if (!isSyncing && blockNumber <= this.lastProcessedBlock) return;
    if (this.processingBlocks.has(blockNumber)) return;
    
    this.processingBlocks.add(blockNumber);
    try {
      if (!isSyncing || blockNumber % 10 === 0) {
        console.log(`⛓️  ${isSyncing ? '[Syncing]' : '[Real-time]'} Processing block: ${blockNumber}`);
      }
      
      // Use eth_getBlockByNumber directly to ensure we get full transaction objects across all RPCs
      // Convert block number to hex without leading zeros (strict JSON-RPC spec)
      const blockHex = "0x" + blockNumber.toString(16);
      const block = await this.httpProvider.send("eth_getBlockByNumber", [
        blockHex,
        true
      ]);
      
      if (!block || !block.transactions) return;

      for (const tx of block.transactions) {
        // In RPC response, tx fields are hex strings. normalizeAddress handles it.
        if (tx.to && normalizeAddress(tx.to) === this.systemAddress) {
          await this.handleTransaction(tx, blockNumber);
        }
      }

      // Persist progress to DB
      try {
        await PollerState.findByIdAndUpdate(
          POLLER_STATE_KEY,
          { lastProcessedLedger: blockNumber },
          { upsert: true }
        );
      } catch (err) {
        console.error("❌ Failed to persist block poller state:", err);
      }
      
      // Update high-water mark
      if (blockNumber > this.lastProcessedBlock) {
        this.lastProcessedBlock = blockNumber;
      }
    } finally {
      this.processingBlocks.delete(blockNumber);
    }
  }

  async handleTransaction(tx, blockNumber) {
    const from = normalizeAddress(tx.from);
    const to = normalizeAddress(tx.to); // "Merchant wallet"
    
    // In raw RPC response, value is hex. ethers.formatEther/BigInt handles it.
    const valueWei = BigInt(tx.value).toString();
    const txHash = tx.hash;
    
    // Raw RPC uses 'transactionIndex'
    const transactionIndex = tx.transactionIndex;

    console.log(`💰 Detected transfer: ${ethers.formatEther(valueWei)} BNB from ${from} to ${to} (Index: ${transactionIndex})`);

    // 1. Check if we already recorded this transaction
    const existingTx = await BnbTransaction.findOne({ txHash });
    if (existingTx) {
      if (existingTx.processed) return;
      // If recorded but not processed, we'll try to process it below
    } else {
      // Record the raw transaction
      await BnbTransaction.create({
        txHash,
        from,
        to,
        valueWei,
        blockNumber,
        transactionIndex,
        processed: false,
      });
    }

    // 2. Try to match with a pending deposit intent exactly by WEI value
    console.log(`🔍 [Watcher] Looking for intent: amountWei=${valueWei}, asset=BNB, status=pending`);
    const intents = await UsdtDepositIntent.find({
      amountWei: valueWei,
      status: "pending",
      asset: "BNB",
      expiresAt: { $gt: new Date() },
    }).limit(2);

    if (intents.length > 1) {
      console.warn(`⚠️ COLLISION: Multiple pending intents found for amount ${valueWei} WEI. Using first match.`);
    }

    const intent = intents[0];

    if (intent) {
      console.log(`🎯 [Watcher] Match found! ReferenceId: ${intent.referenceId}, User: ${intent.user}`);
      
      try {
        const result = await processBnbTransaction(txHash, {
          intent,
          userId: intent.user,
        });

        if (result.success) {
          console.log(`✅ [Watcher] Successfully processed deposit for user ${intent.user}. Tx: ${txHash}`);
          
          await BnbTransaction.updateOne(
            { txHash },
            { processed: true }
          );

          intent.status = "completed";
          intent.tx_hash = txHash;
          intent.completedAt = new Date();
          await intent.save();
        } else {
          // If it's just waiting for confirmations, it's not a 'failure' but we wait.
          if (result.status === "pending_confirmations") {
            console.log(`⏳ [Watcher] Pending confirmations for ${txHash}: ${result.message}`);
          } else {
            console.error(`❌ [Watcher] Failed to process matched transaction ${txHash}: ${result.message} (Status: ${result.status})`);
          }
        }
      } catch (error) {
        console.error(`❌ [Watcher] Exception during transaction processing for ${txHash}:`, error);
      }
    } else {
      console.log(`ℹ️ [Watcher] No matching pending intent for WEI ${valueWei} in block ${blockNumber}`);
    }
  }
}

// Standalone execution support
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const watcher = new BscWatcherService();
      await watcher.start();
    } catch (err) {
      console.error("Fatal error starting watcher:", err);
      process.exit(1);
    }
  })();
}

module.exports = new BscWatcherService();
