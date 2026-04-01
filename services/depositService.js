const { ethers } = require("ethers");
const User = require("../models/User");
const UsdtDeposit = require("../models/UsdtDeposit");
const LedgerRow = require("../models/LedgerRow");
const mongoose = require("mongoose");
const { addDecimal128 } = require("../utils/decimal128Utils");
const { getOrCreateLedger, createLedgerEntry } = require("../jobs/helpers/ledgerHelpers");
const {
  BSC_CONFIRMATIONS,
  assertMainnet,
  getProvider,
  getUsdtContract,
  normalizeAddress,
} = require("../utils/bsc");

const TRANSFER_SELECTOR = "0xa9059cbb";
const SUPPORTED_USDT_DECIMALS = new Set([6, 18]);
const BNB_DECIMALS = 18;

const toDecimal128 = (value) => mongoose.Types.Decimal128.fromString(value.toString());

async function findDepositLedgerRow({ userId, referenceId, txHash }) {
  const orConditions = [];
  if (referenceId) {
    orConditions.push({ referenceId });
  }
  if (txHash) {
    orConditions.push({ txHash }, { refId: txHash });
  }
  if (!orConditions.length) return null;
  return LedgerRow.findOne({
    userId,
    eventType: { $in: ["DEPOSIT", "DEPOSIT_PENDING"] },
    $or: orConditions,
  });
}

async function upsertDepositLedgerRow({
  userId,
  referenceId,
  txHash,
  status,
  eventType,
  amount,
  intentAmount,
  amountWei,
  fromAddress,
  toAddress,
  txTimestamp,
  blockNumber,
  txMetadata,
  txRaw,
  receiptRaw,
  narrative,
  processingError,
  walletFrom = "EXTERNAL",
  walletTo = "BNB",
  asset = "BNB",
  network = "BSC",
}) {
  const row = await findDepositLedgerRow({ userId, referenceId, txHash });
  if (!row) {
    const created = new LedgerRow({
      userId,
      eventType: eventType || "DEPOSIT_PENDING",
      amount: toDecimal128(amount ?? "0"),
      walletFrom,
      walletTo,
      narrative,
      refId: txHash || undefined,
      referenceId,
      txHash,
      intentAmount: intentAmount != null ? toDecimal128(intentAmount) : undefined,
      amountWei,
      fromAddress,
      toAddress,
      txTimestamp,
      blockNumber,
      txMetadata,
      txRaw,
      receiptRaw,
      asset,
      network,
      processingError,
      status: status || "INITIATED",
    });
    await created.save();
    return created;
  }

  if (eventType) row.eventType = eventType;
  if (status) row.status = status;
  if (typeof amount !== "undefined") row.amount = toDecimal128(amount);
  if (typeof intentAmount !== "undefined") row.intentAmount = toDecimal128(intentAmount);
  if (typeof amountWei !== "undefined") row.amountWei = amountWei;
  if (typeof fromAddress !== "undefined") row.fromAddress = fromAddress;
  if (typeof toAddress !== "undefined") row.toAddress = toAddress;
  if (typeof txTimestamp !== "undefined") row.txTimestamp = txTimestamp;
  if (typeof blockNumber !== "undefined") row.blockNumber = blockNumber;
  if (typeof txMetadata !== "undefined") row.txMetadata = txMetadata;
  if (typeof txRaw !== "undefined") row.txRaw = txRaw;
  if (typeof receiptRaw !== "undefined") row.receiptRaw = receiptRaw;
  if (typeof narrative !== "undefined") row.narrative = narrative;
  if (typeof processingError !== "undefined") row.processingError = processingError;
  if (typeof txHash !== "undefined") row.txHash = txHash;
  if (txHash) row.refId = txHash;
  if (typeof referenceId !== "undefined") row.referenceId = referenceId;
  if (typeof asset !== "undefined") row.asset = asset;
  if (typeof network !== "undefined") row.network = network;
  if (!row.walletFrom) row.walletFrom = walletFrom;
  if (!row.walletTo) row.walletTo = walletTo;
  await row.save();
  return row;
}

function getSystemDepositAddress() {
  const primary = process.env.BSC_SYSTEM_DEPOSIT_ADDRESS;
  if (!primary) {
    throw new Error("BSC_SYSTEM_DEPOSIT_ADDRESS is not configured.");
  }
  return normalizeAddress(primary);
}

function normalizeAssetType(value) {
  return `${value || "BNB"}`.toUpperCase();
}

async function getConfirmations(provider, blockNumber) {
  const latestBlock = await provider.getBlockNumber();
  return latestBlock - blockNumber + 1;
}

/**
 * Processes a single USDT transaction by its hash.
 * @param {string} txHash - Transaction hash.
 * @param {object} options - Mapping and validation options.
 * @returns {object} Result of processing.
 */
async function processUsdtTransaction(txHash, options = {}) {
  const { userId, intent } = options;
  if (!userId && !intent?.user) {
    return { success: false, status: "no_user", message: "User mapping is required." };
  }

  let expectedAmount = options.expectedAmount;
  let expectedFrom = options.expectedFrom;
  let expectedTo = options.expectedTo;
  let resolvedUserId = userId;

  if (intent) {
    if (resolvedUserId && String(intent.user) !== String(resolvedUserId)) {
      return { success: false, status: "no_user", message: "Deposit intent user mismatch." };
    }
    resolvedUserId = intent.user;
    expectedAmount = intent.amount;
    if (intent.wallet_address && !intent.allowAnySender) {
      expectedFrom = intent.wallet_address;
    }
    expectedTo = intent.deposit_address;
  }

  let systemAddress;
  try {
    systemAddress = getSystemDepositAddress();
  } catch (error) {
    return { success: false, status: "config_error", message: error.message };
  }
  const expectedToNormalized = expectedTo ? normalizeAddress(expectedTo) : systemAddress;
  if (expectedToNormalized !== systemAddress) {
    return {
      success: false,
      status: "config_error",
      message: "Deposit address mismatch with configured system wallet.",
    };
  }

  const existingLedgerRow = await LedgerRow.findOne({ refId: txHash, eventType: "DEPOSIT" });
  if (existingLedgerRow) {
    return {
      success: false,
      status: "duplicate",
      message: `Transaction ID ${txHash} has already been recorded in the ledger.`,
    };
  }

  const existingDeposit = await UsdtDeposit.findOne({ tx_hash: txHash });
  if (existingDeposit) {
    return {
      success: false,
      status: "duplicate",
      message: `Transaction ID ${txHash} already recorded (status: ${existingDeposit.status}).`,
    };
  }

  const user = await User.findById(resolvedUserId);
  if (!user) {
    return {
      success: false,
      status: "no_user",
      message: "User not found for this deposit request.",
    };
  }

  const authenticatedUserId = user._id;
  let newDeposit;

  try {
    const provider = getProvider();
    await assertMainnet(provider);

    const usdt = getUsdtContract(provider);
    const decimals = Number(await usdt.decimals());
    if (!SUPPORTED_USDT_DECIMALS.has(decimals)) {
      return {
        success: false,
        status: "validation_failed",
        message: `Unexpected USDT decimals: ${decimals}`,
      };
    }

    const transferEvent = usdt.interface.getEvent("Transfer");
    const transferTopic = transferEvent.topicHash;

    newDeposit = new UsdtDeposit({
      user: authenticatedUserId,
      wallet_address: "",
      tx_hash: txHash,
      amount: "0",
      status: "pending_verification",
      ledgerTimestamp: new Date(),
      network: "BEP20",
    });
    await newDeposit.save();

    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.to) {
      newDeposit.status = "failed";
      newDeposit.processingError = "Transaction not found.";
      await newDeposit.save();
      return { success: false, status: "validation_failed", message: newDeposit.processingError };
    }

    if (normalizeAddress(tx.to) !== normalizeAddress(usdt.target)) {
      newDeposit.status = "failed";
      newDeposit.processingError = "Transaction target is not the USDT contract.";
      await newDeposit.save();
      return { success: false, status: "validation_failed", message: newDeposit.processingError };
    }

    if (!tx.data || !tx.data.startsWith(TRANSFER_SELECTOR)) {
      newDeposit.status = "failed";
      newDeposit.processingError = "Transaction is not a USDT transfer.";
      await newDeposit.save();
      return { success: false, status: "invalid_type", message: newDeposit.processingError };
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      const errorMessage = "Transaction not found or failed";
      newDeposit.status = "failed";
      newDeposit.processingError = errorMessage;
      await newDeposit.save();
      return { success: false, status: "validation_failed", message: errorMessage };
    }

    const confirmations = await getConfirmations(provider, receipt.blockNumber);
    if (confirmations < BSC_CONFIRMATIONS) {
      newDeposit.status = "pending_verification";
      newDeposit.processingError = `Waiting for confirmations (${confirmations}/${BSC_CONFIRMATIONS}).`;
      await newDeposit.save();
      return { success: false, status: "pending_confirmations", message: newDeposit.processingError };
    }

    const transferLogs = receipt.logs.filter((log) => {
      return normalizeAddress(log.address) === normalizeAddress(usdt.target) && log.topics[0] === transferTopic;
    });

    if (!transferLogs.length) {
      newDeposit.status = "failed";
      newDeposit.processingError = "No USDT Transfer event found in transaction logs";
      await newDeposit.save();
      return { success: false, status: "validation_failed", message: newDeposit.processingError };
    }

  const expectedFromNormalized = expectedFrom ? normalizeAddress(expectedFrom) : null;
  const expectedValue = expectedAmount
    ? ethers.parseUnits(expectedAmount.toString(), decimals)
    : null;

    let matchedLog;
    let parsed;
    for (const log of transferLogs) {
      const candidate = usdt.interface.parseLog(log);
      const from = normalizeAddress(candidate.args.from);
      const to = normalizeAddress(candidate.args.to);
      const value = candidate.args.value;

      if (to !== systemAddress) continue;
      if (expectedFromNormalized && from !== expectedFromNormalized) continue;
      if (expectedValue && value !== expectedValue) continue;

      matchedLog = log;
      parsed = candidate;
      break;
    }

    if (!matchedLog) {
      newDeposit.status = "failed";
      newDeposit.processingError = "Transfer validation failed against expected parameters.";
      await newDeposit.save();
      return { success: false, status: "validation_failed", message: newDeposit.processingError };
    }

    const from = normalizeAddress(parsed.args.from);
    const to = normalizeAddress(parsed.args.to);
    const value = parsed.args.value;

    if (expectedFromNormalized && normalizeAddress(tx.from) !== expectedFromNormalized) {
      newDeposit.status = "failed";
      newDeposit.processingError = "Sender wallet mismatch.";
      await newDeposit.save();
      return { success: false, status: "sender_mismatch", message: newDeposit.processingError };
    }

    const amount = ethers.formatUnits(value, decimals);
    const ledgerTimestamp = receipt.blockNumber ? new Date() : new Date();

    newDeposit.amount = amount.toString();
    newDeposit.status = "completed";
    newDeposit.ledgerTimestamp = ledgerTimestamp;
    newDeposit.processingError = null;
    newDeposit.wallet_address = from;
    newDeposit.token_contract = normalizeAddress(usdt.target);
    newDeposit.decimals = decimals;

    user.usdtBalance = (user.usdtBalance || 0) + Number(amount);
    await user.save();

    const ledger = await getOrCreateLedger(authenticatedUserId);
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(amount.toString());

    ledger.wallets.bnb = addDecimal128(ledger.wallets.bnb, depositAmountD128);
    ledger.wallets.zeroRisk = addDecimal128(ledger.wallets.zeroRisk, depositAmountD128);
    ledger.wallets.zeroRiskIpfs = addDecimal128(ledger.wallets.zeroRiskIpfs, depositAmountD128);
    ledger.markModified("wallets");
    await ledger.save();
    await newDeposit.save();

    await createLedgerEntry({
      userId: authenticatedUserId,
      eventType: "DEPOSIT",
      amount: depositAmountD128.toString(),
      walletFrom: "EXTERNAL",
      walletTo: "USDT",
      narrative: `USDT wallet deposit. TxHash: ${txHash}`,
      refId: txHash,
    });

    return {
      success: true,
      status: "completed",
      message: "USDT deposit recorded and added to USDT wallet.",
      deposit: newDeposit,
      usdtWalletBalance: amount,
    };
  } catch (error) {
    console.error(`Error processing USDT transaction ${txHash}:`, error);
    if (newDeposit && newDeposit._id) {
      await UsdtDeposit.updateOne(
        { _id: newDeposit._id },
        { status: "failed", processingError: error.message || "Unexpected error." }
      );
    }
    return { success: false, status: "error", message: "Server error processing deposit.", error: error.message };
  }
}

module.exports = {
  processUsdtTransaction,
  processBnbTransaction,
  verifyDepositIntent,
  verifyUsdtDepositIntent,
  verifyBnbDepositIntent,
  upsertDepositLedgerRow,
};

async function verifyUsdtDepositIntent(intent) {
  if (!intent) {
    return { success: false, status: "not_found", message: "Deposit intent not found." };
  }

  if (intent.status === "completed") {
    return {
      success: true,
      status: "completed",
      message: "Deposit already completed.",
      txHash: intent.tx_hash,
    };
  }

  const now = new Date();
  if (now > intent.expiresAt) {
    if (intent.status !== "expired") {
      intent.status = "expired";
      await intent.save();
    }
    await upsertDepositLedgerRow({
      userId: intent.user,
      referenceId: intent.referenceId,
      status: "FAILED",
      eventType: "DEPOSIT_PENDING",
      processingError: "Deposit intent expired.",
      narrative: "Deposit intent expired.",
      asset: "BNB",
      network: "BSC",
    });
    return { success: false, status: "expired", message: "Deposit intent expired." };
  }

  if (!intent.tx_hash) {
    return { success: false, status: "pending", message: "Awaiting transaction hash." };
  }

  const result = await processUsdtTransaction(intent.tx_hash, {
    intent,
    userId: intent.user,
  });

  if (result.success || (result.status === "duplicate" && intent.tx_hash)) {
    intent.status = "completed";
    intent.completedAt = new Date();
    intent.processingError = null;
    await intent.save();
    return {
      success: true,
      status: "completed",
      message: result.message || "Deposit completed.",
      txHash: intent.tx_hash,
    };
  }

  if (result.status === "pending_confirmations") {
    intent.status = "pending";
    intent.processingError = result.message;
    await intent.save();
    return { success: false, status: "pending_confirmations", message: result.message };
  }

  intent.status = "failed";
  intent.processingError =
    result.status === "duplicate"
      ? "Transaction hash already used for another deposit."
      : result.message || "Failed to process deposit.";
  await intent.save();
  await upsertDepositLedgerRow({
    userId: intent.user,
    referenceId: intent.referenceId,
    txHash: intent.tx_hash,
    status: "FAILED",
    eventType: "DEPOSIT_PENDING",
    processingError: intent.processingError,
    narrative: intent.processingError,
    asset: "BNB",
    network: "BSC",
  });
  return { success: false, status: "failed", message: intent.processingError };
}

async function processBnbTransaction(txHash, options = {}) {
  const { userId, intent } = options;
  if (!userId && !intent?.user) {
    return { success: false, status: "no_user", message: "User mapping is required." };
  }

  let expectedAmount = options.expectedAmount;
  let expectedAmountWei = options.expectedAmountWei;
  let expectedFrom = options.expectedFrom;
  let expectedTo = options.expectedTo;
  let resolvedUserId = userId;

  if (intent) {
    if (resolvedUserId && String(intent.user) !== String(resolvedUserId)) {
      return { success: false, status: "no_user", message: "Deposit intent user mismatch." };
    }
    resolvedUserId = intent.user;
    expectedAmount = intent.amount;
    expectedAmountWei = intent.amountWei;
    if (intent.wallet_address && !intent.allowAnySender) {
      expectedFrom = intent.wallet_address;
    }
    expectedTo = intent.deposit_address;
  }

  let systemAddress;
  try {
    systemAddress = getSystemDepositAddress();
  } catch (error) {
    return { success: false, status: "config_error", message: error.message };
  }
  const expectedToNormalized = expectedTo ? normalizeAddress(expectedTo) : systemAddress;
  if (expectedToNormalized !== systemAddress) {
    return {
      success: false,
      status: "config_error",
      message: "Deposit address mismatch with configured system wallet.",
    };
  }

  const existingLedgerRow = await LedgerRow.findOne({
    eventType: "DEPOSIT",
    status: "COMPLETED",
    $or: [{ refId: txHash }, { txHash }],
  });
  if (existingLedgerRow) {
    return {
      success: false,
      status: "duplicate",
      message: `Transaction ID ${txHash} has already been recorded in the ledger.`,
    };
  }

  const user = await User.findById(resolvedUserId);
  if (!user) {
    return {
      success: false,
      status: "no_user",
      message: "User not found for this deposit request.",
    };
  }

  let ledgerRow;

  try {
    const provider = getProvider();
    await assertMainnet(provider);

    ledgerRow = await upsertDepositLedgerRow({
      userId: user._id,
      referenceId: intent?.referenceId,
      txHash,
      status: "INITIATED",
      eventType: "DEPOSIT_PENDING",
      amount: "0",
      intentAmount: intent?.amount,
      narrative: "BNB deposit submitted for verification.",
      asset: "BNB",
      network: "BSC",
    });

    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.to) {
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: "Transaction not found.",
        narrative: "Transaction not found.",
      });
      return { success: false, status: "validation_failed", message: "Transaction not found." };
    }

    if (normalizeAddress(tx.to) !== systemAddress) {
      const message = "Transaction destination is not the system wallet.";
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: message,
        narrative: message,
      });
      return { success: false, status: "wrong_destination", message };
    }

    if (tx.data && tx.data !== "0x") {
      const message = "Transaction is not a native transfer.";
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: message,
        narrative: message,
      });
      return { success: false, status: "invalid_type", message };
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      const errorMessage = "Transaction not found or failed";
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: errorMessage,
        narrative: errorMessage,
      });
      return { success: false, status: "validation_failed", message: errorMessage };
    }

    const confirmations = await getConfirmations(provider, receipt.blockNumber);
    if (confirmations < BSC_CONFIRMATIONS) {
      const message = `Waiting for confirmations (${confirmations}/${BSC_CONFIRMATIONS}).`;
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "INITIATED",
        eventType: "DEPOSIT_PENDING",
        processingError: message,
        narrative: message,
      });
      return { success: false, status: "pending_confirmations", message };
    }

    const expectedFromNormalized = expectedFrom ? normalizeAddress(expectedFrom) : null;
    let expectedValue = null;
    if (expectedAmountWei) {
      try {
        expectedValue = BigInt(expectedAmountWei);
      } catch (error) {
        const message = "Invalid expected amount (wei).";
        await upsertDepositLedgerRow({
          userId: user._id,
          referenceId: intent?.referenceId,
          txHash,
          status: "FAILED",
          eventType: "DEPOSIT_PENDING",
          processingError: message,
          narrative: message,
        });
        return { success: false, status: "validation_failed", message };
      }
    } else if (expectedAmount) {
      expectedValue = ethers.parseUnits(expectedAmount.toString(), BNB_DECIMALS);
    }

    if (expectedFromNormalized && normalizeAddress(tx.from) !== expectedFromNormalized) {
      const message = "Sender wallet mismatch.";
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: message,
        narrative: message,
      });
      return { success: false, status: "sender_mismatch", message };
    }

    if (expectedValue && tx.value !== expectedValue) {
      const message = "Transfer amount mismatch.";
      await upsertDepositLedgerRow({
        userId: user._id,
        referenceId: intent?.referenceId,
        txHash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: message,
        narrative: message,
      });
      return { success: false, status: "amount_error", message };
    }

    const amount = ethers.formatUnits(tx.value, BNB_DECIMALS);
    let txTimestamp = null;
    if (receipt.blockNumber != null) {
      const block = await provider.getBlock(receipt.blockNumber);
      if (block?.timestamp) {
        txTimestamp = new Date(block.timestamp * 1000);
      }
    }

    const txMetadata = {
      from: normalizeAddress(tx.from),
      to: normalizeAddress(tx.to),
      value: tx.value?.toString(),
      nonce: tx.nonce,
      gasPrice: tx.gasPrice?.toString(),
      gasLimit: tx.gasLimit?.toString(),
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.index,
      status: receipt.status,
    };

    const ledger = await getOrCreateLedger(user._id);
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(amount.toString());
    ledger.wallets.bnb = addDecimal128(ledger.wallets.bnb, depositAmountD128);
    ledger.wallets.zeroRisk = addDecimal128(ledger.wallets.zeroRisk, depositAmountD128);
    ledger.wallets.zeroRiskIpfs = addDecimal128(ledger.wallets.zeroRiskIpfs, depositAmountD128);
    ledger.markModified("wallets");
    await ledger.save();

    ledgerRow = await upsertDepositLedgerRow({
      userId: user._id,
      referenceId: intent?.referenceId,
      txHash,
      status: "COMPLETED",
      eventType: "DEPOSIT",
      amount: depositAmountD128.toString(),
      amountWei: tx.value?.toString(),
      fromAddress: normalizeAddress(tx.from),
      toAddress: normalizeAddress(tx.to),
      txTimestamp,
      blockNumber: receipt.blockNumber,
      txMetadata,
      txRaw: tx,
      receiptRaw: receipt,
      narrative: `BNB wallet deposit. TxHash: ${txHash}`,
      processingError: null,
      asset: "BNB",
      network: "BSC",
    });

    return {
      success: true,
      status: "completed",
      message: "BNB deposit recorded.",
      deposit: ledgerRow,
    };
  } catch (error) {
    console.error(`Error processing BNB transaction ${txHash}:`, error);
    await upsertDepositLedgerRow({
      userId: resolvedUserId,
      referenceId: intent?.referenceId,
      txHash,
      status: "FAILED",
      eventType: "DEPOSIT_PENDING",
      processingError: error.message || "Unexpected error.",
      narrative: error.message || "Unexpected error.",
    });
    return { success: false, status: "error", message: "Server error processing deposit.", error: error.message };
  }
}

async function verifyBnbDepositIntent(intent) {
  if (!intent) {
    return { success: false, status: "not_found", message: "Deposit intent not found." };
  }

  if (intent.status === "completed") {
    return {
      success: true,
      status: "completed",
      message: "Deposit already completed.",
      txHash: intent.tx_hash,
    };
  }

  const now = new Date();
  if (now > intent.expiresAt) {
    if (intent.status !== "expired") {
      intent.status = "expired";
      await intent.save();
    }
    return { success: false, status: "expired", message: "Deposit intent expired." };
  }

  if (!intent.tx_hash) {
    return { success: false, status: "pending", message: "Awaiting transaction hash." };
  }

  const result = await processBnbTransaction(intent.tx_hash, {
    intent,
    userId: intent.user,
  });

  if (result.success || (result.status === "duplicate" && intent.tx_hash)) {
    intent.status = "completed";
    intent.completedAt = new Date();
    intent.processingError = null;
    await intent.save();
    return {
      success: true,
      status: "completed",
      message: result.message || "Deposit completed.",
      txHash: intent.tx_hash,
    };
  }

  if (result.status === "pending_confirmations") {
    intent.status = "pending";
    intent.processingError = result.message;
    await intent.save();
    return { success: false, status: "pending_confirmations", message: result.message };
  }

  intent.status = "failed";
  intent.processingError =
    result.status === "duplicate"
      ? "Transaction hash already used for another deposit."
      : result.message || "Failed to process deposit.";
  await intent.save();
  return { success: false, status: "failed", message: intent.processingError };
}

async function verifyDepositIntent(intent) {
  const asset = normalizeAssetType(intent?.asset);
  if (asset === "BNB" || (asset === "USDT" && !intent?.token_contract)) {
    return verifyBnbDepositIntent(intent);
  }
  return verifyUsdtDepositIntent(intent);
}
