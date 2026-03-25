const User = require('../models/User');
const XrpDeposit = require('../models/XrpDeposit');
const Outbox = require('../models/Outbox'); // Added for outbox event queuing
const xrpl = require('xrpl');
const mongoose = require('mongoose');
const { addDecimal128 } = require('../utils/decimal128Utils');
const { processXrpTransaction } = require('../services/depositService');
const fetch = require("node-fetch");
const DepositAddress = require("../models/DepositAddress");


const XRP_LEDGER_SERVER = process.env.XRP_LEDGER_SERVER_URL || 'wss://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7';
const SYSTEM_DEPOSIT_WALLET = process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS;

// Helper function to connect to XRPL
async function getXrplClient() {
  const client = new xrpl.Client(XRP_LEDGER_SERVER);
  await client.connect();
  return client;
}

// Get deposits history for authenticated user
exports.getDepositsHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const deposits = await XrpDeposit.find({ user: userId })
      .sort({ createdAt: -1 })
      .select('transactionId amount status walletAddress timestamp')
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

exports.recordXrpDeposit = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User not authenticated.' });
  }
  
  const { xrpAddress, transactionId } = req.body;

  if (!xrpAddress || !transactionId) {
    return res.status(400).json({ success: false, message: 'Missing xrpAddress or transactionId.' });
  }

  try {
    const result = await processXrpTransaction(transactionId, xrpAddress);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: result.message,
        deposit: result.deposit,
        xamanWalletBalance: result.xamanWalletBalance,
        zeroRiskLimitIncreased: result.xamanWalletBalance // Assuming this is correct based on original logic
      });
    }

    // Handle specific, non-successful but non-error cases
    switch (result.status) {
      case 'duplicate':
        return res.status(409).json({ success: false, message: result.message });
      case 'no_user':
        return res.status(404).json({ success: false, message: result.message });
      case 'validation_failed':
      case 'invalid_type':
      case 'wrong_destination':
      case 'sender_mismatch':
      case 'amount_error':
        return res.status(400).json({ success: false, message: result.message });
      default:
        // For 'error' status or any other unhandled case
        return res.status(500).json({ success: false, message: result.message || 'An unexpected server error occurred.' });
    }
  } catch (error) {
    console.error('Unhandled error in recordXrpDeposit controller:', error);
    res.status(500).json({ success: false, message: 'Server error processing deposit.', error: error.message });
  }
}; 

// ======================================================================
// 📥 POST /api/deposit-address
// Record or update the system deposit address
// ======================================================================
exports.recordDepositAddress = async (req, res) => {
  try {
    // 1️⃣ Call the secure BEPVault allocation endpoint
    const allocationRes = await fetch("https://pay.BEPVault.io/v1/deposits/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // you can include identifying body if required by securepayments API
      body: JSON.stringify({ requestedBy: req.user?._id || "system" }),
    });

    if (!allocationRes.ok) {
      return res.status(allocationRes.status).json({
        success: false,
        message: `Failed to get deposit address from BEPVault (${allocationRes.status})`,
      });
    }

    const data = await allocationRes.json();
    if (!data.classic || data.destination_tag === undefined) {
      return res.status(400).json({
        success: false,
        message: "Invalid response format from BEPVault allocate API",
      });
    }

    // 2️⃣ Deactivate old ones
  //  await DepositAddress.updateMany({ isActive: true }, { $set: { isActive: false } });

    // 3️⃣ Save new one to DB
    const newAddress = await DepositAddress.create({
      wallet_address: data.classic,
      destination_tag: data.destination_tag,
      isActive: true,
    });

    console.log("✅ Stored new deposit address:", newAddress);

    // 4️⃣ Respond to frontend with live values
    return res.status(200).json({
      success: true,
      message: "New system deposit address allocated successfully.",
      deposit_address: {
        wallet_address: newAddress.wallet_address,
        destination_tag: newAddress.destination_tag,
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
