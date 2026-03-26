const { ethers } = require("ethers");
const User = require("../models/User");
const UsdtDeposit = require("../models/UsdtDeposit");
const {
  processUsdtTransaction,
  processBnbTransaction,
  verifyDepositIntent,
} = require("../services/depositService");
const DepositAddress = require("../models/DepositAddress");
const UsdtDepositIntent = require("../models/UsdtDepositIntent");
const { normalizeAddress } = require("../utils/bsc");
const { v4: uuidv4 } = require("uuid");

// Get deposits history for authenticated user
exports.getDepositsHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const deposits = await UsdtDeposit.find({ user: userId })
      .sort({ createdAt: -1 })
      .select('tx_hash amount status wallet_address timestamp')
      .lean();

    res.json({
      success: true,
      deposits: deposits.map(deposit => ({
        ...deposit,
        amount: parseFloat(deposit.amount).toFixed(6),
        timestamp: deposit.timestamp || deposit.createdAt
      }))
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
        zeroRiskLimitIncreased: result.usdtWalletBalance
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
        return res.status(409).json({ success: false, message: result.message });
      case 'pending_confirmations':
        if (intent) {
          intent.status = "pending";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(202).json({ success: false, message: result.message });
      case 'no_user':
        return res.status(404).json({ success: false, message: result.message });
      case 'validation_failed':
      case 'invalid_type':
      case 'wrong_destination':
      case 'sender_mismatch':
      case 'amount_error':
        return res.status(400).json({ success: false, message: result.message });
      default:
        if (intent && result.status !== "duplicate") {
          intent.status = "failed";
          intent.processingError = result.message;
          await intent.save();
        }
        // For 'error' status or any other unhandled case
        return res.status(500).json({ success: false, message: result.message || 'An unexpected server error occurred.' });
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
      return res.status(400).json({
        success: false,
        message: "Deposit intent is not for BNB.",
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

    const result = await processBnbTransaction(tx_hash, {
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
      });
    }

    switch (result.status) {
      case "duplicate":
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
        return res.status(409).json({ success: false, message: result.message });
      case "pending_confirmations":
        if (intent) {
          intent.status = "pending";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(202).json({ success: false, message: result.message });
      case "no_user":
        return res.status(404).json({ success: false, message: result.message });
      case "validation_failed":
      case "invalid_type":
      case "wrong_destination":
      case "sender_mismatch":
      case "amount_error":
        return res.status(400).json({ success: false, message: result.message });
      default:
        if (intent && result.status !== "duplicate") {
          intent.status = "failed";
          intent.processingError = result.message;
          await intent.save();
        }
        return res.status(500).json({
          success: false,
          message: result.message || "An unexpected server error occurred.",
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
    if (!["USDT", "BNB"].includes(asset)) {
      return res.status(400).json({ success: false, message: "Unsupported asset type." });
    }

    const providedWallet =
      asset === "BNB" ? "" : req.body.wallet_address || req.user.wallet_address || "";
    let normalizedWallet = "";
    if (providedWallet) {
      try {
        normalizedWallet = normalizeAddress(providedWallet);
      } catch (error) {
        return res.status(400).json({ success: false, message: "Invalid wallet address." });
      }
    }

    const depositAddress = process.env.BSC_SYSTEM_DEPOSIT_ADDRESS;
    if (!depositAddress) {
      return res.status(500).json({
        success: false,
        message: "System deposit address is not configured.",
      });
    }

    const tokenDecimals =
      asset === "BNB" ? 18 : Number(process.env.BSC_USDT_DECIMALS || "18");
    try {
      if (ethers.parseUnits(rawAmount, tokenDecimals) <= 0n) {
        return res.status(400).json({ success: false, message: "Invalid amount." });
      }
    } catch (error) {
      return res.status(400).json({ success: false, message: "Invalid amount." });
    }

    const tokenContract =
      asset === "BNB" ? "" : process.env.USDT_CONTRACT_ADDRESS_MAINNET;
    if (asset === "USDT" && !tokenContract) {
      return res.status(500).json({
        success: false,
        message: "USDT contract address is not configured.",
      });
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

    const allowAnySender = asset === "BNB" ? true : !normalizedWallet;
    const intent = await UsdtDepositIntent.create({
      user: req.user._id,
      wallet_address: normalizedWallet,
      deposit_address: normalizedDeposit,
      amount: rawAmount,
      referenceId: uuidv4(),
      status: "pending",
      expiresAt,
      network: "BEP20",
      allowAnySender,
      token_contract: tokenContract ? normalizeAddress(tokenContract) : undefined,
      decimals: tokenDecimals,
      chainId,
      asset,
    });

    return res.status(200).json({
      success: true,
      message: "Deposit intent created.",
      referenceId: intent.referenceId,
      deposit_address: intent.deposit_address,
      wallet_address: intent.wallet_address,
      amount: intent.amount,
      expiresAt: intent.expiresAt,
      network: intent.network,
      tokenContract: intent.token_contract,
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
    }).lean();

    if (!intent) {
      return res.status(404).json({ success: false, message: "Deposit intent not found." });
    }

    return res.status(200).json({
      success: true,
      intent: {
        referenceId: intent.referenceId,
        deposit_address: intent.deposit_address,
        wallet_address: intent.wallet_address,
        amount: intent.amount,
        token_contract: intent.token_contract,
        decimals: intent.decimals,
        chainId: intent.chainId,
        asset: intent.asset,
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

    const result = await verifyDepositIntent(intent);
    return res.status(result.success ? 200 : 400).json(result);
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
    console.log(`✅ Loaded ${DEPOSIT_ADDRESS_LIST.length} deposit addresses into memory.`);
  } catch (err) {
    console.error("❌ Error loading deposit addresses:", err);
  }
}


exports.getDepositAddressList = () => DEPOSIT_ADDRESS_LIST;
