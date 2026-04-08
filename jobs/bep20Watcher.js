const { ethers } = require("ethers");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");
const LedgerRow = require("../models/LedgerRow");
const {
  getProvider,
  getWssProvider,
  normalizeAddress,
  BSC_CONFIRMATIONS,
} = require("../utils/bsc");
const {
  verifyDepositIntent,
  upsertDepositLedgerRow,
} = require("../services/depositService");

const processingTx = new Set();
const processingIntent = new Set();

function getSystemDepositAddress() {
  const wallet = process.env.BSC_SYSTEM_DEPOSIT_ADDRESS;
  if (!wallet) {
    throw new Error("BSC_SYSTEM_DEPOSIT_ADDRESS is not configured.");
  }
  return normalizeAddress(wallet);
}

function getToleranceBps() {
  const raw = Number(
    process.env.BSC_DEPOSIT_MATCH_TOLERANCE_BPS ||
      process.env.DEPOSIT_MATCH_TOLERANCE_BPS ||
      50
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : 50;
}

function isWithinTolerance(value, expected) {
  const bps = getToleranceBps();
  const tolerance = (expected * BigInt(bps)) / 10000n;
  const min = expected > tolerance ? expected - tolerance : 0n;
  const max = expected + tolerance;
  return value >= min && value <= max;
}

function getExpectedAmountWei(intent) {
  if (intent?.amountWei) {
    try {
      return BigInt(intent.amountWei);
    } catch {
      return 0n;
    }
  }
  const decimals = Number.isFinite(Number(intent?.decimals))
    ? Number(intent.decimals)
    : 18;
  try {
    return ethers.parseUnits(String(intent?.amount || "0"), decimals);
  } catch {
    return 0n;
  }
}

async function matchDepositIntent({ valueWei, fromAddr, toAddr, lateWindowMs }) {
  const cutoff = new Date(Date.now() - lateWindowMs);
  const candidates = await UsdtDepositIntent.find({
    asset: { $in: ["BNB", "BEP20", ""] },
    status: { $in: ["pending", "expired"] },
    expiresAt: { $gte: cutoff },
  })
    .sort({ createdAt: 1 })
    .lean();

  let best = null;
  let bestDiff = null;
  let bestTimeDiff = null;

  for (const intent of candidates) {
    const depositAddr = normalizeAddress(intent.deposit_address);
    if (depositAddr !== toAddr) continue;

    if (!intent.allowAnySender && intent.wallet_address) {
      const expectedFrom = normalizeAddress(intent.wallet_address);
      if (expectedFrom && expectedFrom !== fromAddr) continue;
    }

    const expected = getExpectedAmountWei(intent);
    if (expected <= 0n || !isWithinTolerance(valueWei, expected)) continue;

    const diff = expected > valueWei ? expected - valueWei : valueWei - expected;
    const timeDiff = intent.createdAt
      ? Math.abs(Date.now() - new Date(intent.createdAt).getTime())
      : 0;

    if (
      bestDiff === null ||
      diff < bestDiff ||
      (diff === bestDiff && (bestTimeDiff === null || timeDiff < bestTimeDiff))
    ) {
      best = intent;
      bestDiff = diff;
      bestTimeDiff = timeDiff;
    }
  }

  return best;
}

async function handleTransaction({ tx, timestamp, systemAddress, lateWindowMs }) {
  const txHash = tx.hash;
  if (!txHash || processingTx.has(txHash)) return;

  const toAddr = tx.to ? normalizeAddress(tx.to) : null;
  if (!toAddr || toAddr !== systemAddress) return;

  if (!tx.value || BigInt(tx.value.toString()) <= 0n) return;

  processingTx.add(txHash);
  try {
    const existingIntent = await UsdtDepositIntent.findOne({ tx_hash: txHash }).lean();
    if (existingIntent) return;

    const existingLedger = await LedgerRow.findOne({
      eventType: "DEPOSIT",
      status: "COMPLETED",
      $or: [{ txHash: txHash }, { refId: txHash }],
    }).lean();
    if (existingLedger) return;

    const fromAddr = tx.from ? normalizeAddress(tx.from) : null;
    if (!fromAddr) return;

    const matchedIntent = await matchDepositIntent({
      valueWei: BigInt(tx.value.toString()),
      fromAddr,
      toAddr: systemAddress,
      lateWindowMs,
    });

    if (!matchedIntent) return;

    if (matchedIntent.tx_hash && matchedIntent.tx_hash !== txHash) {
      return;
    }

    const now = new Date();
    const nextExpiresAt = matchedIntent.expiresAt && matchedIntent.expiresAt > now
      ? matchedIntent.expiresAt
      : new Date(now.getTime() + lateWindowMs);

    const updatedIntent = await UsdtDepositIntent.findByIdAndUpdate(
      matchedIntent._id,
      {
        tx_hash: txHash,
        status: "pending",
        processingError: null,
        expiresAt: nextExpiresAt,
      },
      { new: true }
    );

    await upsertDepositLedgerRow({
      userId: matchedIntent.user,
      referenceId: matchedIntent.referenceId,
      txHash: txHash,
      status: "INITIATED",
      eventType: "DEPOSIT_PENDING",
      amount: "0",
      intentAmount: matchedIntent.amount,
      fromAddress: fromAddr,
      toAddress: systemAddress,
      txTimestamp: timestamp ? new Date(timestamp * 1000) : undefined,
      blockNumber: tx.blockNumber,
      narrative: "BNB deposit detected on-chain.",
      asset: matchedIntent.asset || "BNB",
      network: "BSC",
    });

    if (updatedIntent) {
      await verifyDepositIntent(updatedIntent);
    }
  } catch (error) {
    console.error("[bep20Watcher] Transaction handling failed:", error.message);
  } finally {
    processingTx.delete(txHash);
  }
}

async function updateConfirmations() {
  const intents = await UsdtDepositIntent.find({
    status: "pending",
    tx_hash: { $exists: true, $ne: "" },
  });

  for (const intent of intents) {
    const key = String(intent._id);
    if (processingIntent.has(key)) continue;
    processingIntent.add(key);
    try {
      await verifyDepositIntent(intent);
    } catch (error) {
      console.error("[bep20Watcher] Confirmation update failed:", error.message);
    } finally {
      processingIntent.delete(key);
    }
  }
}

function start() {
  const provider = getProvider();
  const wssProvider = getWssProvider();
  const requiredConfs = Number(
    process.env.BSC_CONFIRMATIONS ||
      process.env.CONFIRMATIONS_REQUIRED ||
      BSC_CONFIRMATIONS ||
      3
  );
  const pollIntervalMs = Number(
    process.env.BSC_WATCHER_POLL_MS || process.env.WATCHER_POLL_MS || 6000
  );
  const confirmIntervalMs = Number(
    process.env.BSC_WATCHER_CONFIRM_MS || 15000
  );
  const lateWindowMinutes = Number(
    process.env.BSC_DEPOSIT_LATE_MATCH_WINDOW_MIN ||
      process.env.DEPOSIT_LATE_MATCH_WINDOW_MIN ||
      60
  );
  const lateWindowMs =
    Number.isFinite(lateWindowMinutes) && lateWindowMinutes > 0
      ? lateWindowMinutes * 60 * 1000
      : 60 * 60 * 1000;
  const alwaysOn = String(process.env.BSC_WATCHER_ALWAYS_ON || "")
    .trim()
    .toLowerCase() === "true";

  const systemAddress = getSystemDepositAddress();

  let lastProcessedBlock = null;
  let pollRunning = false;
  let watchEnabled = alwaysOn;
  let lastIntentCheck = 0;
  const intentCheckIntervalMs = Number(
    process.env.WATCHER_INTENT_CHECK_MS || 15000
  );

  const refreshWatchState = async () => {
    if (alwaysOn) {
      if (!watchEnabled) {
        watchEnabled = true;
      }
      return;
    }
    const now = Date.now();
    if (now - lastIntentCheck < intentCheckIntervalMs) return;
    lastIntentCheck = now;

    const cutoff = new Date(Date.now() - lateWindowMs);
    const activeIntent = await UsdtDepositIntent.findOne({
      asset: { $in: ["BNB", "BEP20", ""] },
      status: { $in: ["pending", "expired"] },
      expiresAt: { $gte: cutoff },
      $or: [{ tx_hash: { $exists: false } }, { tx_hash: "" }, { tx_hash: null }],
    })
      .select("_id")
      .lean();

    const nextEnabled = Boolean(activeIntent);
    if (nextEnabled !== watchEnabled) {
      const latest = await provider.getBlockNumber();
      lastProcessedBlock = Math.max(0, latest - requiredConfs);
      console.log("[bep20Watcher] Watcher state changed", {
        enabled: nextEnabled,
        blockCursor: lastProcessedBlock,
      });
    }
    watchEnabled = nextEnabled;
  };

  const initBlockCursor = async () => {
    const latest = await provider.getBlockNumber();
    const startRaw = process.env.WATCHER_START_BLOCK;
    if (startRaw && Number.isFinite(Number(startRaw))) {
      lastProcessedBlock = Number(startRaw);
      return;
    }
    lastProcessedBlock = Math.max(0, latest - requiredConfs);
  };

  const scanNativeTransfers = async (blockNumber) => {
    const block = await provider.getBlock(blockNumber, true);
    if (!block || !Array.isArray(block.transactions)) return;

    for (const entry of block.transactions) {
      if (!entry) continue;
      const tx = typeof entry === "string"
        ? await provider.getTransaction(entry)
        : entry;
      if (!tx || !tx.to) continue;
      await handleTransaction({
        tx,
        timestamp: block.timestamp,
        systemAddress,
        lateWindowMs,
      });
    }
  };

  const handleBlock = async (blockNumber) => {
    if (!watchEnabled) return;
    try {
      await scanNativeTransfers(blockNumber);
      await updateConfirmations();
    } catch (error) {
      console.error("[bep20Watcher] Block handling failed:", error.message);
    }
  };

  const pollBlocks = async () => {
    if (pollRunning) return;
    pollRunning = true;
    try {
      await refreshWatchState();
      if (!watchEnabled) return;
      if (lastProcessedBlock === null) {
        await initBlockCursor();
      }
      const latest = await provider.getBlockNumber();
      if (latest > lastProcessedBlock) {
        for (let block = lastProcessedBlock + 1; block <= latest; block += 1) {
          await handleBlock(block);
        }
        lastProcessedBlock = latest;
      }
    } catch (error) {
      console.error("[bep20Watcher] Polling failed:", error.message);
    } finally {
      pollRunning = false;
    }
  };

  if (wssProvider) {
    wssProvider.on("block", handleBlock);
    wssProvider.on("error", (err) => {
      console.error("[bep20Watcher] WSS error:", err?.message || err);
    });
    if (wssProvider._websocket) {
      wssProvider._websocket.on("close", () => {
        console.warn("[bep20Watcher] WSS closed, polling continues.");
      });
    }
  }

  setInterval(updateConfirmations, confirmIntervalMs);
  setInterval(pollBlocks, pollIntervalMs);
  pollBlocks();

  console.log("[bep20Watcher] BSC watcher started (BNB native transfers)");
}

module.exports = { start };
