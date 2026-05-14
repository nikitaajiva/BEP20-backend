const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const PhantomDepositIntent = require("../models/PhantomDepositIntent");
const User = require("../models/User");
const { upsertDepositLedgerRow } = require("../services/depositService");
const { v4: uuidv4 } = require("uuid");

const getSolanaConnection = () => {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  return new Connection(rpcUrl, "confirmed");
};

/**
 * Create a new deposit intent and generate Solana Pay URL
 */
exports.createPhantomDepositIntent = async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;
    const userId = req.user._id;

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Invalid deposit amount." });
    }

    const referenceId = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes TTL
    const treasuryAddress = process.env.SOLANA_TREASURY_ADDRESS;

    if (!treasuryAddress) {
      return res.status(500).json({ success: false, message: "Treasury address not configured." });
    }

    const amountLamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

    const intent = new PhantomDepositIntent({
      user: userId,
      referenceId,
      amount: amount.toString(),
      status: "created",
      expiresAt,
    });

    await intent.save();

    // Generate Solana Pay URL
    // Format: solana:<address>?amount=<amount>&reference=<referenceId>&label=BEPVault%20Deposit
    const solanaPayUrl = `solana:${treasuryAddress}?amount=${amount}&reference=${referenceId}&label=BEPVault%20Deposit`;

    // Create the "intent" row in the ledger as PENDING
    await upsertDepositLedgerRow({
      userId,
      referenceId,
      status: "INITIATED",
      eventType: "DEPOSIT_PENDING",
      amount: "0",
      intentAmount: amount,
      narrative: `SOL deposit intent created. Ref: ${referenceId}`,
      asset: "SOL",
      network: "SOLANA",
    });

    res.status(201).json({
      success: true,
      intent: {
        id: referenceId, // Frontend expects .id
        amount: amount,
        amountLamports: amountLamports,
        treasuryAddress: treasuryAddress,
        status: intent.status,
      },
      solanaPayUrl: solanaPayUrl,
    });
  } catch (error) {
    console.error("Create Phantom Deposit Intent Error:", error);
    res.status(500).json({ success: false, message: "Server error creating deposit intent." });
  }
};

/**
 * Verify the transaction on-chain and credit the ledger
 */
exports.confirmPhantomDeposit = async (req, res) => {
  try {
    const { intentId, txSignature } = req.body; // Frontend sends intentId and txSignature
    const userId = req.user._id;

    if (!intentId || !txSignature) {
      return res.status(400).json({ success: false, message: "Intent ID and Transaction Signature are required." });
    }

    const intent = await PhantomDepositIntent.findOne({ referenceId: intentId, user: userId });
    if (!intent) {
      return res.status(404).json({ success: false, message: "Deposit intent not found." });
    }

    if (intent.status === "completed") {
      return res.status(200).json({ success: true, message: "Deposit already processed." });
    }

    intent.tx_hash = txSignature;
    intent.status = "submitted";
    await intent.save();

    // On-chain verification
    const connection = getSolanaConnection();
    const treasuryAddress = process.env.SOLANA_TREASURY_ADDRESS;

    // Fetch transaction
    const tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      // Don't fail immediately, might be just slow
      return res.status(202).json({ success: false, message: "Transaction pending verification." });
    }

    // Verify treasury received funds
    const accountKeys = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;
    const treasuryIndex = accountKeys.findIndex((key) => key.toBase58() === treasuryAddress);
    
    if (treasuryIndex === -1) {
      intent.status = "failed";
      intent.processingError = "Treasury address not found in transaction.";
      await intent.save();
      return res.status(400).json({ success: false, message: "Invalid transaction destination." });
    }

    const meta = tx.meta;
    const receivedLamports = meta.postBalances[treasuryIndex] - meta.preBalances[treasuryIndex];
    const receivedSol = receivedLamports / LAMPORTS_PER_SOL;

    const expectedSol = parseFloat(intent.amount);
    if (receivedSol < expectedSol * 0.99) {
      intent.status = "failed";
      intent.processingError = `Amount mismatch. Expected ${expectedSol}, received ${receivedSol}.`;
      await intent.save();
      return res.status(400).json({ success: false, message: "Transaction amount mismatch." });
    }

    // Success!
    intent.status = "completed";
    intent.completedAt = new Date();
    await intent.save();

    // Credit Ledger
    const { getOrCreateLedger } = require("../jobs/helpers/ledgerHelpers");
    const mongoose = require("mongoose");
    const { addDecimal128 } = require("../utils/decimal128Utils");
    
    const ledger = await getOrCreateLedger(userId);
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(receivedSol.toString());
    
    ledger.wallets.sol = addDecimal128(ledger.wallets.sol || "0.0", depositAmountD128);
    ledger.markModified("wallets");
    await ledger.save();

    await upsertDepositLedgerRow({
      userId,
      referenceId: intentId,
      txHash: txSignature,
      status: "COMPLETED",
      eventType: "DEPOSIT",
      amount: receivedSol.toString(),
      narrative: `SOL deposit confirmed. TxHash: ${txSignature}`,
      asset: "SOL",
      network: "SOLANA",
      txMetadata: {
        slot: tx.slot,
        blockTime: tx.blockTime,
        fee: meta.fee,
      }
    });

    res.status(200).json({
      success: true,
      message: "Deposit confirmed successfully.",
      intent: {
        id: intent.referenceId,
        status: intent.status,
      }
    });
  } catch (error) {
    console.error("Confirm Phantom Deposit Error:", error);
    res.status(500).json({ success: false, message: "Server error confirming deposit." });
  }
};

/**
 * Get status of an intent
 */
exports.getPhantomDepositStatus = async (req, res) => {
  try {
    const { intentId } = req.params; // Parameter renamed to intentId
    const userId = req.user._id;

    const intent = await PhantomDepositIntent.findOne({ referenceId: intentId, user: userId });
    if (!intent) {
      return res.status(404).json({ success: false, message: "Deposit intent not found." });
    }

    res.status(200).json({
      success: true,
      intent: {
        id: intent.referenceId,
        status: intent.status,
        txHash: intent.tx_hash,
        completedAt: intent.completedAt,
        processingError: intent.processingError,
      }
    });
  } catch (error) {
    console.error("Get Phantom Deposit Status Error:", error);
    res.status(500).json({ success: false, message: "Server error fetching status." });
  }
};
