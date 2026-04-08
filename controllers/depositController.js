const crypto = require("crypto");
const { ethers } = require("ethers");
const LedgerRow = require("../models/LedgerRow");
const { verifyDepositIntent, upsertDepositLedgerRow } = require("../services/depositService");
const DepositAddress = require("../models/DepositAddress");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");
const { normalizeAddress, toBnbWei } = require("../utils/bsc");
const { v4: uuidv4 } = require("uuid");

const formatAmount = (value, decimals = 18) => {
  const raw = ethers.formatUnits(value, decimals);
  return raw.includes(".") ? raw.replace(/\.?0+$/, "") : raw;
};

const getAdjustmentBounds = (originalAmountWei, decimals = 18) => {
  const minRaw =
    process.env.BSC_DEPOSIT_ADJUST_MIN ||
    process.env.DEPOSIT_ADJUST_MIN ||
    "0";
  const maxRaw =
    process.env.BSC_DEPOSIT_ADJUST_MAX ||
    process.env.DEPOSIT_ADJUST_MAX ||
    "0.0001";
  const maxBpsRaw = Number(
    process.env.BSC_DEPOSIT_ADJUST_MAX_BPS ||
      process.env.DEPOSIT_ADJUST_MAX_BPS ||
      50
  );
  const maxBps = Number.isFinite(maxBpsRaw) && maxBpsRaw >= 0 ? maxBpsRaw : 50;

  let minAbs = ethers.parseUnits(String(minRaw), decimals);
  let maxAbs = ethers.parseUnits(String(maxRaw), decimals);
  if (minAbs < 0n) minAbs = 0n;
  if (maxAbs < 0n) maxAbs = 0n;

  let maxByBps = 0n;
  if (originalAmountWei > 0n && maxBps > 0) {
    maxByBps = (originalAmountWei * BigInt(maxBps)) / 10000n;
  }

  let max = maxAbs;
  if (maxByBps > 0n && maxByBps < max) {
    max = maxByBps;
  }

  let min = minAbs;
  if (min > max) min = max;
  return { min, max };
};

const randomOffset = (min, max) => {
  const range = max - min;
  if (range <= 0n) return min;
  const span = range + 1n;
  const maxUint64 = 1n << 64n;
  const threshold = maxUint64 - (maxUint64 % span);

  while (true) {
    const buf = crypto.randomBytes(8);
    const value = BigInt(`0x${buf.toString("hex")}`);
    if (value < threshold) {
      return min + (value % span);
    }
  }
};

// Get deposits history for authenticated user
exports.getDepositsHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const deposits = await LedgerRow.find({
      userId,
      eventType: "DEPOSIT",
      walletTo: "BNB",
      status: "COMPLETED",
    })
      .sort({ ts: -1 })
      .select("txHash refId amount status fromAddress toAddress txTimestamp ts")
      .lean();

    res.json({
      success: true,
      deposits: deposits.map((deposit) => ({
        tx_hash: deposit.txHash || deposit.refId || "",
        amount: parseFloat(deposit.amount?.toString() || "0").toFixed(6),
        status: deposit.status,
        wallet_address: deposit.fromAddress || "",
        to_address: deposit.toAddress || "",
        timestamp: deposit.txTimestamp || deposit.ts,
      })),
    });
  } catch (error) {
    console.error('Error fetching deposits history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch deposits history'
    });
  }
};

exports.recordUsdtDeposit = async (req, res) => {
  return res.status(400).json({
    success: false,
    message: "USDT deposits are disabled. Please use BNB deposits.",
  });

  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User not authenticated.' });
  }
  
  const { tx_hash, referenceId } = req.body;

  if (!tx_hash) {
    return res.status(400).json({ success: false, message: 'Missing tx_hash.' });
  }

  try {
    if (!referenceId) {
      return res.status(400).json({
        success: false,
        message: "referenceId is required to verify deposits.",
      });
    }

    const intent = await UsdtDepositIntent.findOne({
      referenceId,
      user: req.user._id,
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Deposit intent not found for this referenceId.",
      });
    }

    if (intent.status === "completed") {
      return res.status(409).json({
        success: false,
        message: "Deposit intent already completed.",
      });
    }

    if (intent.asset && intent.asset.toUpperCase() !== "USDT") {
      return res.status(400).json({
        success: false,
        message: "Deposit intent is not for USDT.",
      });
    }

    if (intent.expiresAt && new Date() > intent.expiresAt) {
      intent.status = "expired";
      await intent.save();
      return res.status(400).json({
        success: false,
        message: "Deposit intent expired. Please create a new intent.",
      });
    }

    const result = await processUsdtTransaction(tx_hash, {
      intent,
      userId: req.user._id,
    });

    if (result.success) {
      intent.status = "completed";
      intent.tx_hash = tx_hash;
      intent.completedAt = new Date();
      intent.processingError = null;
      await intent.save();

      return res.status(200).json({
        success: true,
        message: result.message,
        deposit: result.deposit,
        usdtWalletBalance: result.usdtWalletBalance,
        zeroRiskLimitIncreased: result.usdtWalletBalance,
        intentAmount: intent.amount,
        intentAmountWei: intent.amountWei,
        asset: intent.asset,
        referenceId: intent.referenceId,
        txHash: intent.tx_hash,
      });
    }

    // Handle specific, non-successful but non-error cases
    switch (result.status) {
      case 'duplicate':
        if (intent && intent.tx_hash === tx_hash) {
          intent.status = "completed";
          intent.tx_hash = tx_hash;
          intent.completedAt = intent.completedAt || new Date();
          intent.processingError = null;
          await intent.save();
        } else if (intent) {
          intent.status = "failed";
          intent.processingError = "Transaction hash already used.";
          await intent.save();
        }
        return res.status(409).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case 'pending_confirmations':
        if (intent) {
          intent.status = "pending";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(202).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case 'no_user':
        return res.status(404).json({ success: false, message: result.message });
      case 'validation_failed':
      case 'invalid_type':
      case 'wrong_destination':
      case 'sender_mismatch':
      case 'amount_error':
        return res.status(400).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      default:
        if (intent && result.status !== "duplicate") {
          intent.status = "failed";
          intent.processingError = result.message;
          await intent.save();
        }
        // For 'error' status or any other unhandled case
        return res.status(500).json({
          success: false,
          message: result.message || "An unexpected server error occurred.",
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
    }
  } catch (error) {
    console.error('Unhandled error in recordUsdtDeposit controller:', error);
    res.status(500).json({ success: false, message: 'Server error processing deposit.', error: error.message });
  }
}; 

exports.recordBnbDeposit = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "User not authenticated." });
  }

  const { tx_hash, referenceId } = req.body;

  if (!tx_hash) {
    return res.status(400).json({ success: false, message: "Missing tx_hash." });
  }

  try {
    if (!referenceId) {
      return res.status(400).json({
        success: false,
        message: "referenceId is required to verify deposits.",
      });
    }

    const intent = await UsdtDepositIntent.findOne({
      referenceId,
      user: req.user._id,
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Deposit intent not found for this referenceId.",
      });
    }

    if (intent.status === "completed") {
      return res.status(409).json({
        success: false,
        message: "Deposit intent already completed.",
      });
    }

    if (intent.asset && intent.asset.toUpperCase() !== "BNB") {
      await upsertDepositLedgerRow({
        userId: req.user._id,
        referenceId: intent.referenceId,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: "Deposit intent is not for BNB.",
        narrative: "Deposit intent is not for BNB.",
        asset: intent.asset || "BNB",
        network: "BSC",
      });
      return res.status(400).json({
        success: false,
        message: "Deposit intent is not for BNB.",
      });
    }

    if (intent.expiresAt && new Date() > intent.expiresAt) {
      intent.status = "expired";
      await intent.save();
      await upsertDepositLedgerRow({
        userId: req.user._id,
        referenceId: intent.referenceId,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: "Deposit intent expired. Please create a new intent.",
        narrative: "Deposit intent expired. Please create a new intent.",
        asset: intent.asset || "BNB",
        network: "BSC",
      });
      return res.status(400).json({
        success: false,
        message: "Deposit intent expired. Please create a new intent.",
      });
    }

    if (intent.tx_hash && intent.tx_hash !== tx_hash) {
      await upsertDepositLedgerRow({
        userId: req.user._id,
        referenceId: intent.referenceId,
        txHash: intent.tx_hash,
        status: "FAILED",
        eventType: "DEPOSIT_PENDING",
        processingError: "A different transaction hash is already submitted for this intent.",
        narrative: "A different transaction hash is already submitted for this intent.",
        asset: intent.asset || "BNB",
        network: "BSC",
      });
      return res.status(409).json({
        success: false,
        message: "A different transaction hash is already submitted for this intent.",
      });
    }

    if (!intent.tx_hash) {
      intent.tx_hash = tx_hash;
      await intent.save();
    }

    await upsertDepositLedgerRow({
      userId: req.user._id,
      referenceId: intent.referenceId,
      txHash: tx_hash,
      status: "INITIATED",
      eventType: "DEPOSIT_PENDING",
      amount: "0",
      intentAmount: intent.amount,
      narrative: "BNB deposit submitted for verification.",
      asset: intent.asset || "BNB",
      network: "BSC",
    });

    const result = await verifyDepositIntent(intent);

    if (result.success) {
      intent.status = "completed";
      intent.completedAt = new Date();
      intent.processingError = null;
      await intent.save();

      return res.status(200).json({
        success: true,
        message: result.message,
        deposit: result.deposit,
        intentAmount: intent.amount,
        intentAmountWei: intent.amountWei,
        asset: intent.asset,
        referenceId: intent.referenceId,
        txHash: intent.tx_hash,
      });
    }

    switch (result.status) {
      case "duplicate":
        if (intent && intent.tx_hash === tx_hash) {
          intent.status = "completed";
          intent.completedAt = intent.completedAt || new Date();
          intent.processingError = null;
          await intent.save();
        } else if (intent) {
          intent.status = "failed";
          intent.processingError = "Transaction hash already used.";
          await intent.save();
          await upsertDepositLedgerRow({
            userId: req.user._id,
            referenceId: intent.referenceId,
            txHash: tx_hash,
            status: "FAILED",
            eventType: "DEPOSIT_PENDING",
            processingError: "Transaction hash already used.",
            narrative: "Transaction hash already used.",
            asset: intent.asset || "BNB",
            network: "BSC",
          });
        }
        return res.status(409).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case "pending_confirmations":
        if (intent) {
          intent.status = "pending";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(202).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case "pending":
        return res.status(202).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case "expired":
        return res.status(410).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case "failed":
        return res.status(400).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      case "no_user":
        return res.status(404).json({ success: false, message: result.message });
      case "validation_failed":
      case "invalid_type":
      case "wrong_destination":
      case "sender_mismatch":
      case "amount_error":
        return res.status(400).json({
          success: false,
          message: result.message,
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
      default:
        if (intent && result.status !== "duplicate") {
          intent.status = "failed";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(500).json({
          success: false,
          message: result.message || "An unexpected server error occurred.",
          intentAmount: intent.amount,
          intentAmountWei: intent.amountWei,
          asset: intent.asset,
          referenceId: intent.referenceId,
          txHash: intent.tx_hash || tx_hash,
        });
    }
  } catch (error) {
    console.error("Unhandled error in recordBnbDeposit controller:", error);
    return res.status(500).json({
      success: false,
      message: "Server error processing deposit.",
      error: error.message,
    });
  }
};

// ======================================================================
// 📥 POST /api/deposit-address
// Record or update the system deposit address
// ======================================================================
exports.recordDepositAddress = async (req, res) => {
  try {
    const walletAddress = process.env.BSC_SYSTEM_DEPOSIT_ADDRESS;
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "BSC_SYSTEM_DEPOSIT_ADDRESS must be set.",
      });
    }

    // 4️⃣ Respond to frontend with live values
    return res.status(200).json({
      success: true,
      message: "System deposit address resolved successfully.",
      deposit_address: {
        wallet_address: walletAddress,
      },
    });
  } catch (error) {
    console.error("Error recording system deposit address:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while recording deposit address.",
      error: error.message,
    });
  }
};

// ======================================================================
// 📥 POST /api/deposits/intent
// Create a pending QR deposit intent (no wallet extension flow)
// ======================================================================
exports.createDepositIntent = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "User not authenticated." });
    }

    const rawAmount = `${req.body.amount ?? ""}`.trim();
    if (!rawAmount || !/^\d+(\.\d+)?$/.test(rawAmount)) {
      return res.status(400).json({ success: false, message: "Invalid amount." });
    }

    const asset = `${req.body.asset || req.body.assetType || "BNB"}`.toUpperCase();
    if (asset !== "BNB") {
      return res.status(400).json({ success: false, message: "Only BNB deposits are supported." });
    }

    const depositAddress = process.env.BSC_SYSTEM_DEPOSIT_ADDRESS;
    if (!depositAddress) {
      return res.status(500).json({
        success: false,
        message: "System deposit address is not configured.",
      });
    }

    const tokenDecimals = 18;
    let amountWei;
    try {
      amountWei = toBnbWei(rawAmount);
      if (amountWei <= 0n) {
        return res.status(400).json({ success: false, message: "Invalid amount." });
      }
    } catch (error) {
      return res.status(400).json({ success: false, message: "Invalid amount." });
    }

    const chainId = Number(process.env.BSC_CHAIN_ID || "56");

    let normalizedDeposit;
    try {
      normalizedDeposit = normalizeAddress(depositAddress);
    } catch (error) {
      return res.status(500).json({ success: false, message: "Invalid system deposit address." });
    }

    const ttlMs = Number(process.env.BSC_DEPOSIT_INTENT_TTL_MS || "900000");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const { min: adjustMin, max: adjustMax } = getAdjustmentBounds(
      amountWei,
      tokenDecimals
    );
    const adjustAttempts = Number(
      process.env.BSC_DEPOSIT_ADJUST_ATTEMPTS ||
        process.env.DEPOSIT_ADJUST_ATTEMPTS ||
        6
    );
    let adjustedWei = null;

    for (let attempt = 0; attempt < adjustAttempts; attempt += 1) {
      const offset = randomOffset(adjustMin, adjustMax);
      const candidate = amountWei + offset;
      const exists = await UsdtDepositIntent.exists({
        status: "pending",
        expiresAt: { $gt: now },
        amountWei: candidate.toString(),
      });
      if (!exists) {
        adjustedWei = candidate;
        break;
      }
    }

    if (!adjustedWei) {
      adjustedWei = amountWei + adjustMin;
    }

    const adjustedAmount = formatAmount(adjustedWei, tokenDecimals);
    amountWei = adjustedWei;

    const expiredIntents = await UsdtDepositIntent.find({
      user: req.user._id,
      status: "pending",
      expiresAt: { $lte: now },
    }).select("referenceId asset");
    if (expiredIntents.length) {
      await UsdtDepositIntent.updateMany(
        {
          user: req.user._id,
          status: "pending",
          expiresAt: { $lte: now },
        },
        { status: "expired" }
      );
      const expiredRefs = expiredIntents.map((intent) => intent.referenceId);
      await LedgerRow.updateMany(
        {
          userId: req.user._id,
          eventType: "DEPOSIT_PENDING",
          referenceId: { $in: expiredRefs },
          status: "INITIATED",
        },
        {
          status: "FAILED",
          processingError: "Deposit intent expired.",
          narrative: "Deposit intent expired.",
        }
      );
    }

    const existingIntent = await UsdtDepositIntent.findOne({
      user: req.user._id,
      status: "pending",
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });

    if (existingIntent) {
      await upsertDepositLedgerRow({
        userId: req.user._id,
        referenceId: existingIntent.referenceId,
        status: "INITIATED",
        eventType: "DEPOSIT_PENDING",
        amount: "0",
        intentAmount: existingIntent.amount,
        narrative: "BNB deposit intent created.",
        asset: existingIntent.asset || "BNB",
        network: existingIntent.network || "BSC",
      });
      return res.status(409).json({
        success: false,
        message: "You already have a pending deposit intent.",
        intent: {
          referenceId: existingIntent.referenceId,
          deposit_address: existingIntent.deposit_address,
          amount: existingIntent.amount,
          amountWei: existingIntent.amountWei,
          expiresAt: existingIntent.expiresAt,
          network: existingIntent.network,
          decimals: existingIntent.decimals,
          chainId: existingIntent.chainId,
          asset: existingIntent.asset,
        },
      });
    }

    const allowAnySender = true;
    const intent = await UsdtDepositIntent.create({
      user: req.user._id,
      wallet_address: "",
      deposit_address: normalizedDeposit,
      amount: adjustedAmount,
      amountWei: amountWei.toString(),
      referenceId: uuidv4(),
      status: "pending",
      expiresAt,
      network: "BEP20",
      allowAnySender,
      decimals: tokenDecimals,
      chainId,
      asset,
    });

    await upsertDepositLedgerRow({
      userId: req.user._id,
      referenceId: intent.referenceId,
      status: "INITIATED",
      eventType: "DEPOSIT_PENDING",
      amount: "0",
      intentAmount: intent.amount,
      narrative: "BNB deposit intent created.",
      asset: intent.asset || "BNB",
      network: intent.network || "BSC",
    });

    return res.status(200).json({
      success: true,
      message: "Deposit intent created.",
      referenceId: intent.referenceId,
      deposit_address: intent.deposit_address,
      wallet_address: intent.wallet_address,
      amount: intent.amount,
      amountWei: intent.amountWei,
      expiresAt: intent.expiresAt,
      network: intent.network,
      decimals: intent.decimals,
      chainId: intent.chainId,
      asset: intent.asset,
    });
  } catch (error) {
    console.error("Error creating deposit intent:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating deposit intent.",
      error: error.message,
    });
  }
};

// ======================================================================
// 🔍 GET /api/deposits/intent/:referenceId
// Fetch a deposit intent for the authenticated user (QR fallback)
// ======================================================================
exports.getDepositIntent = async (req, res) => {
  try {
    const { referenceId } = req.params;
    if (!referenceId) {
      return res.status(400).json({ success: false, message: "referenceId is required." });
    }

    const intent = await UsdtDepositIntent.findOne({
      referenceId,
      user: req.user._id,
    });

    if (!intent) {
      return res.status(404).json({ success: false, message: "Deposit intent not found." });
    }

    if (
      intent.expiresAt &&
      new Date() > intent.expiresAt &&
      intent.status === "pending" &&
      !intent.tx_hash
    ) {
      intent.status = "expired";
      await intent.save();
    }

    return res.status(200).json({
      success: true,
      intent: {
        referenceId: intent.referenceId,
        deposit_address: intent.deposit_address,
        wallet_address: intent.wallet_address,
        amount: intent.amount,
        amountWei: intent.amountWei,
        token_contract: intent.token_contract,
        decimals: intent.decimals,
        chainId: intent.chainId,
        asset: intent.asset,
        tx_hash: intent.tx_hash,
        status: intent.status,
        expiresAt: intent.expiresAt,
        network: intent.network,
      },
    });
  } catch (error) {
    console.error("Error fetching deposit intent:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching deposit intent.",
      error: error.message,
    });
  }
};

// ======================================================================
// 🔍 GET /api/deposits/verify?referenceId=...
// Verify a QR deposit intent on-chain
// ======================================================================
exports.verifyDepositIntent = async (req, res) => {
  try {
    const { referenceId } = req.query;
    if (!referenceId) {
      return res.status(400).json({ success: false, message: "referenceId is required." });
    }

    const intent = await UsdtDepositIntent.findOne({
      referenceId,
      user: req.user._id,
    });
    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Deposit intent not found.",
      });
    }

    const result = await verifyDepositIntent(intent);
    const payload = {
      ...result,
      intentAmount: intent.amount,
      intentAmountWei: intent.amountWei,
      asset: intent.asset,
      referenceId: intent.referenceId,
      txHash: intent.tx_hash || result.txHash || "",
    };
    if (result.status === "pending_confirmations" || result.status === "pending") {
      return res.status(202).json(payload);
    }
    if (result.status === "expired") {
      return res.status(410).json(payload);
    }
    if (result.status === "failed") {
      return res.status(400).json(payload);
    }
    return res.status(result.success ? 200 : 400).json(payload);
  } catch (error) {
    console.error("Error verifying deposit intent:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while verifying deposit intent.",
      error: error.message,
    });
  }
};

let DEPOSIT_ADDRESS_LIST = []; // internal in-memory cache
/**
 * Load all wallet addresses from DepositAddress collection once.
 * This function should be called at server startup.
 */
exports.loadDepositAddressList = async() =>{
  try {
    const docs = await DepositAddress.find({}, { wallet_address: 1, _id: 0 }).lean();
    DEPOSIT_ADDRESS_LIST = docs.map(d => d.wallet_address);
    
  } catch (err) {
    console.error("❌ Error loading deposit addresses:", err);
  }
}


exports.getDepositAddressList = () => DEPOSIT_ADDRESS_LIST;
