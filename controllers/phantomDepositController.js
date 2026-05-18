const crypto = require("crypto");
const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} = require("@solana/web3.js");

const PhantomDepositIntent = require("../models/PhantomDepositIntent");
const { upsertDepositLedgerRow } = require("../services/depositService");
const { creditInternalSolWallet } = require("../services/internalWalletService");
const mongoose = require("mongoose");

const getConnection = () => {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");
  return new Connection(rpcUrl, "confirmed");
};

const getMerchantWalletAddress = () => {
  const address = `${process.env.SOLANA_MERCHANT_WALLET_ADDRESS || process.env.SOLANA_TREASURY_ADDRESS || ""}`.trim();

  if (!address) {
    throw new Error("SOLANA_MERCHANT_WALLET_ADDRESS_NOT_CONFIGURED");
  }

  try {
    return new PublicKey(address).toBase58();
  } catch {
    throw new Error("INVALID_SOLANA_MERCHANT_WALLET_ADDRESS");
  }
};

const parseSolAmount = (amount) => {
  const amountSol = Number(amount);

  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    return null;
  }

  const minSol = Number(process.env.SOLANA_DEPOSIT_MIN_SOL || "0.001");
  const maxSol = Number(process.env.SOLANA_DEPOSIT_MAX_SOL || "100");

  if (amountSol < minSol || amountSol > maxSol) {
    return null;
  }

  const amountLamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) {
    return null;
  }

  return {
    amountSol,
    amountLamports,
  };
};

const createReference = () => new PublicKey(crypto.randomBytes(32)).toBase58();

const serializePhantomDepositIntent = (intent) => ({
  id: intent._id,
  status: intent.status,
  amountSol: intent.amountSol,
  amountLamports: intent.amountLamports,
  currency: intent.currency,
  txSignature: intent.txSignature || null,
  payerWalletAddress: intent.payerWalletAddress || null,
  merchantWalletAddress: intent.merchantWalletAddress || null,
  receivingAddress: intent.merchantWalletAddress || intent.receivingAddress || null,
  reference: intent.reference || null,
  expiresAt: intent.expiresAt,
  confirmedAt: intent.confirmedAt || null,
  failureReason: intent.failureReason || null,
});

const confirmSolDepositAndCredit = async ({ intent, txSignature, verification }) => {
  const duplicateIntent = await PhantomDepositIntent.findOne({
    txSignature,
    _id: { $ne: intent._id },
  });

  if (duplicateIntent) {
    throw new Error("DUPLICATE_DEPOSIT_SIGNATURE");
  }

  const updatedIntent = await PhantomDepositIntent.findOneAndUpdate(
    {
      _id: intent._id,
      status: { $ne: "confirmed" },
    },
    {
      $set: {
        status: "confirmed",
        txSignature,
        payerWalletAddress: verification.payerWalletAddress || null,
        confirmedAt: new Date(),
        nextCheckAt: null,
        failureReason: null,
      },
    },
    { new: true }
  );

  if (!updatedIntent) {
    return await PhantomDepositIntent.findById(intent._id);
  }

  await creditInternalSolWallet({
    userId: updatedIntent.user,
    amountSol: updatedIntent.amountSol,
  });

  await upsertDepositLedgerRow({
    userId: updatedIntent.user,
    referenceId: updatedIntent._id.toString(),
    txHash: updatedIntent.txSignature,
    amount: updatedIntent.amountSol,
    status: "COMPLETED",
    eventType: "DEPOSIT",
    walletTo: "SOL",
    asset: "SOL",
    currency: "SOL",
    network: "SOLANA",
    merchantWalletAddress: updatedIntent.merchantWalletAddress,
    payerWalletAddress: updatedIntent.payerWalletAddress,
    narrative: `SOL deposit confirmed: ${updatedIntent.amountSol} SOL`,
  });

  return updatedIntent;
};

const createPhantomDepositIntent = async (req, res) => {
  try {
    const walletAddress = `${req.user?.phantomWalletAddress || ""}`.trim();
    const paymentMethod = req.body?.paymentMethod === "qr" ? "qr" : "extension";
    const parsedAmount = parseSolAmount(req.body?.amount);

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        errorCode: "PHANTOM_WALLET_NOT_CONNECTED",
        message: "Please connect Phantom wallet before deposit.",
      });
    }

    try {
      new PublicKey(walletAddress);
    } catch {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_PHANTOM_WALLET_ADDRESS",
        message: "Connected Phantom wallet address is invalid.",
      });
    }

    if (!parsedAmount) {
      return res.status(400).json({
        success: false,
        errorCode: "INVALID_DEPOSIT_AMOUNT",
        message: "Please enter a valid SOL amount within allowed limits.",
      });
    }

    const merchantWalletAddress = getMerchantWalletAddress();
    const reference = createReference();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const intent = await PhantomDepositIntent.create({
      user: req.user._id,
      fromWalletAddress: walletAddress,
      merchantWalletAddress,
      reference,
      amountSol: parsedAmount.amountSol,
      amountLamports: parsedAmount.amountLamports,
      network: process.env.SOLANA_NETWORK || "mainnet-beta",
      paymentMethod,
      status: "created",
      expiresAt,
    });

    const solanaPayUrl = new URL(`solana:${merchantWalletAddress}`);
    solanaPayUrl.searchParams.set("amount", String(parsedAmount.amountSol));
    solanaPayUrl.searchParams.set("reference", reference);
    solanaPayUrl.searchParams.set("label", process.env.APP_NAME || "BEPVault");
    solanaPayUrl.searchParams.set(
      "message",
      `Deposit ${parsedAmount.amountSol} SOL`
    );
    solanaPayUrl.searchParams.set("memo", `phantom-deposit:${intent._id}`);

    return res.status(201).json({
      success: true,
      intent: serializePhantomDepositIntent(intent),
      solanaPayUrl: solanaPayUrl.toString(),
    });
  } catch (error) {
    console.error("Create Phantom deposit intent error:", error);

    const depositAddressErrors = [
      "SOLANA_MERCHANT_WALLET_ADDRESS_NOT_CONFIGURED",
      "INVALID_SOLANA_MERCHANT_WALLET_ADDRESS",
    ];

    if (depositAddressErrors.includes(error.message)) {
      return res.status(500).json({
        success: false,
        errorCode: error.message,
        message: "Solana merchant wallet address is not configured properly.",
      });
    }

    return res.status(500).json({
      success: false,
      errorCode: error.message || "PHANTOM_DEPOSIT_INTENT_FAILED",
      message: "Unable to create deposit request right now.",
    });
  }
};

const verifyTransferBySignature = async ({
  txSignature,
  merchantWalletAddress,
  amountLamports,
  expectedSourceWalletAddress,
  requireSourceMatch = false,
}) => {
  const connection = getConnection();

  const tx = await connection.getParsedTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || tx.meta?.err) {
    return {
      valid: false,
      reason: "TRANSACTION_NOT_CONFIRMED_OR_FAILED",
    };
  }

  let payerWalletAddress = null;

  const instructions = tx.transaction.message.instructions || [];

  const hasValidTransfer = instructions.some((instruction) => {
    if (instruction.program !== "system") return false;

    const parsed = instruction.parsed;
    if (!parsed || parsed.type !== "transfer") return false;

    const info = parsed.info || {};
    const source = info.source;
    const destination = info.destination;
    const lamports = Number(info.lamports);

    const destinationMatches = destination === merchantWalletAddress;
    const amountMatches = lamports >= Number(amountLamports);
    const sourceMatches = !requireSourceMatch || source === expectedSourceWalletAddress;

    if (destinationMatches && amountMatches && sourceMatches) {
      payerWalletAddress = source;
      return true;
    }

    return false;
  });

  if (!hasValidTransfer) {
    return {
      valid: false,
      reason: "MATCHING_SOL_TRANSFER_NOT_FOUND",
    };
  }

  return {
    valid: true,
    payerWalletAddress,
    transaction: tx,
  };
};

const confirmPhantomDeposit = async (req, res) => {
  try {
    const { intentId, txSignature } = req.body || {};

    if (!intentId || !txSignature) {
      return res.status(400).json({
        success: false,
        errorCode: "DEPOSIT_CONFIRM_PAYLOAD_INVALID",
        message: "Deposit intent ID and transaction signature are required.",
      });
    }

    const intent = await PhantomDepositIntent.findOne({
      _id: intentId,
      user: req.user._id,
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        errorCode: "DEPOSIT_INTENT_NOT_FOUND",
        message: "Deposit request not found.",
      });
    }

    if (["confirmed", "failed", "expired"].includes(intent.status)) {
      return res.status(200).json({
        success: intent.status === "confirmed",
        status: intent.status,
        message: intent.status === "confirmed" ? "Deposit already confirmed." : "Deposit is no longer active.",
        intent: serializePhantomDepositIntent(intent),
      });
    }

    if (new Date(intent.expiresAt).getTime() < Date.now()) {
      intent.status = "expired";
      intent.failureReason = "Deposit request expired.";
      await intent.save();

      return res.status(400).json({
        success: false,
        errorCode: "DEPOSIT_INTENT_EXPIRED",
        message: "Deposit request expired. Please create a new request.",
      });
    }

    const duplicate = await PhantomDepositIntent.findOne({
      txSignature,
      _id: { $ne: intent._id },
    }).select("_id");

    if (duplicate) {
      return res.status(409).json({
        success: false,
        errorCode: "DUPLICATE_DEPOSIT_SIGNATURE",
        message: "This transaction has already been used for another deposit.",
      });
    }

    const requireSourceMatch = intent.paymentMethod === "extension";

    const verification = await verifyTransferBySignature({
      txSignature,
      merchantWalletAddress: intent.merchantWalletAddress,
      amountLamports: intent.amountLamports,
      expectedSourceWalletAddress: intent.fromWalletAddress,
      requireSourceMatch,
    });

    if (!verification.valid) {
      intent.status = "failed";
      intent.failureReason = verification.reason;
      await intent.save();

      return res.status(400).json({
        success: false,
        errorCode: verification.reason,
        message: "Unable to verify this Solana deposit transaction.",
      });
    }

    let updatedIntent;
    try {
      updatedIntent = await confirmSolDepositAndCredit({
        intent,
        txSignature,
        verification,
      });
    } catch (err) {
      if (err.message === "DUPLICATE_DEPOSIT_SIGNATURE") {
        return res.status(409).json({
          success: false,
          errorCode: "DUPLICATE_DEPOSIT_SIGNATURE",
          message: "This transaction has already been used for another deposit.",
        });
      }
      throw err;
    }

    if (updatedIntent && updatedIntent.status === "confirmed") {
      return res.status(200).json({
        success: true,
        message: "Deposit confirmed successfully.",
        intent: serializePhantomDepositIntent(updatedIntent),
      });
    }

    return res.status(400).json({
      success: false,
      message: "Unable to confirm deposit.",
    });
  } catch (error) {
    console.error("Confirm Phantom deposit error:", error);

    return res.status(500).json({
      success: false,
      errorCode: "PHANTOM_DEPOSIT_CONFIRM_FAILED",
      message: "Unable to confirm deposit right now.",
    });
  }
};

const transactionHasReference = (tx, reference) => {
  const accountKeys = tx?.transaction?.message?.accountKeys || [];

  return accountKeys.some((account) => {
    const key =
      typeof account?.pubkey?.toBase58 === "function"
        ? account.pubkey.toBase58()
        : typeof account?.pubkey === "string"
        ? account.pubkey
        : typeof account === "string"
        ? account
        : "";

    return key === reference;
  });
};

const findTransactionByReference = async ({ reference, limit = 20 }) => {
  const connection = getConnection();
  const referencePublicKey = new PublicKey(reference);

  const signatures = await connection.getSignaturesForAddress(referencePublicKey, {
    limit,
  });

  for (const item of signatures) {
    if (!item?.signature) continue;

    const tx = await connection.getParsedTransaction(item.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || tx.meta?.err) continue;

    if (transactionHasReference(tx, reference)) {
      return {
        signature: item.signature,
        transaction: tx,
      };
    }
  }

  return null;
};


const findTransactionBySenderAndAmount = async ({ merchantAddress, payerAddress, amountLamports, minTime }) => {
  if (!payerAddress) return null;
  const connection = getConnection();
  const merchantPublicKey = new PublicKey(merchantAddress);

  try {
    const signatures = await connection.getSignaturesForAddress(merchantPublicKey, {
      limit: 20,
    });

    for (const item of signatures) {
      if (!item?.signature) continue;

      if (item.blockTime && item.blockTime < Math.floor(minTime / 1000) - 120) {
        continue;
      }

      const tx = await connection.getParsedTransaction(item.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || tx.meta?.err) continue;

      const instructions = tx.transaction.message.instructions || [];
      let match = false;

      instructions.forEach((instruction) => {
        if (instruction.program === "system") {
          const parsed = instruction.parsed;
          if (parsed && parsed.type === "transfer") {
            const info = parsed.info || {};
            const sourceMatches = info.source === payerAddress;
            const destinationMatches = info.destination === merchantAddress;
            const amountMatches = Number(info.lamports) >= Number(amountLamports);

            if (sourceMatches && destinationMatches && amountMatches) {
              match = true;
            }
          }
        }
      });

      if (match) {
        return {
          signature: item.signature,
          transaction: tx,
        };
      }
    }
  } catch (err) {
    console.error("findTransactionBySenderAndAmount error:", err);
  }

  return null;
};

const findTransactionByAnySenderAndAmount = async ({ merchantAddress, amountLamports, minTime }) => {
  const connection = getConnection();
  const merchantPublicKey = new PublicKey(merchantAddress);

  try {
    const signatures = await connection.getSignaturesForAddress(merchantPublicKey, {
      limit: 20,
    });

    for (const item of signatures) {
      if (!item?.signature) continue;

      if (item.blockTime && item.blockTime < Math.floor(minTime / 1000) - 120) {
        continue;
      }

      const tx = await connection.getParsedTransaction(item.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || tx.meta?.err) continue;

      // Ensure this transaction is not already confirmed in any previous deposit intent!
      const alreadyConfirmed = await PhantomDepositIntent.findOne({
        txSignature: item.signature,
        status: "confirmed"
      }).select("_id");

      if (alreadyConfirmed) continue;

      const instructions = tx.transaction.message.instructions || [];
      let match = false;

      instructions.forEach((instruction) => {
        if (instruction.program === "system") {
          const parsed = instruction.parsed;
          if (parsed && parsed.type === "transfer") {
            const info = parsed.info || {};
            const destinationMatches = info.destination === merchantAddress;
            const amountMatches = Number(info.lamports) >= Number(amountLamports);

            if (destinationMatches && amountMatches) {
              match = true;
            }
          }
        }
      });

      if (match) {
        return {
          signature: item.signature,
          transaction: tx,
        };
      }
    }
  } catch (err) {
    console.error("findTransactionByAnySenderAndAmount error:", err);
  }

  return null;
};

const verifyQrSolTransfer = async ({
  reference,
  receivingAddress,
  amountLamports,
  createdAt,
  fromWalletAddress,
}) => {
  // 1. Try traditional Solana Pay reference scanning
  let found = await findTransactionByReference({ reference });

  // 2. If reference scan returns nothing, fallback to scanning merchant's recent transactions for exact sender + amount
  if (!found && fromWalletAddress) {
    found = await findTransactionBySenderAndAmount({
      merchantAddress: receivingAddress,
      payerAddress: fromWalletAddress,
      amountLamports,
      minTime: new Date(createdAt).getTime(),
    });
  }

  // 3. If still not found, search for ANY recent transaction with the exact lamports matching the merchant address
  if (!found) {
    found = await findTransactionByAnySenderAndAmount({
      merchantAddress: receivingAddress,
      amountLamports,
      minTime: new Date(createdAt).getTime(),
    });
  }

  if (!found) {
    return {
      valid: false,
      pending: true,
      reason: "PAYMENT_NOT_FOUND_YET",
    };
  }

  const tx = found.transaction;
  const instructions = tx.transaction.message.instructions || [];

  let payerWalletAddress = null;

  const hasValidTransfer = instructions.some((instruction) => {
    if (instruction.program !== "system") return false;

    const parsed = instruction.parsed;
    if (!parsed || parsed.type !== "transfer") return false;

    const info = parsed.info || {};

    const destinationMatches = info.destination === receivingAddress;
    const amountMatches = Number(info.lamports) >= Number(amountLamports);

    if (destinationMatches && amountMatches) {
      payerWalletAddress = info.source || null;
      return true;
    }

    return false;
  });

  if (!hasValidTransfer) {
    return {
      valid: false,
      pending: false,
      reason: "MATCHING_SOL_TRANSFER_NOT_FOUND",
      txSignature: found.signature,
    };
  }

  return {
    valid: true,
    pending: false,
    txSignature: found.signature,
    payerWalletAddress,
    transaction: tx,
  };
};

const getPhantomDepositStatus = async (req, res) => {
  try {
    const intent = await PhantomDepositIntent.findOne({
      _id: req.params.intentId,
      user: req.user._id,
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        errorCode: "DEPOSIT_INTENT_NOT_FOUND",
        message: "Deposit request not found.",
      });
    }

    if (intent.status === "confirmed") {
      return res.status(200).json({
        success: true,
        message: "Deposit already confirmed.",
        intent: serializePhantomDepositIntent(intent),
      });
    }

    if (["failed", "expired"].includes(intent.status)) {
      return res.status(200).json({
        success: true,
        intent: serializePhantomDepositIntent(intent),
      });
    }

    if (new Date(intent.expiresAt).getTime() < Date.now()) {
      intent.status = "expired";
      intent.failureReason = "Deposit request expired.";
      await intent.save();

      return res.status(200).json({
        success: true,
        intent: serializePhantomDepositIntent(intent),
      });
    }

    if (intent.nextCheckAt && new Date(intent.nextCheckAt).getTime() > Date.now()) {
      return res.status(200).json({
        success: true,
        message: "Payment check is cooling down.",
        intent: serializePhantomDepositIntent(intent),
        retryAfterMs: new Date(intent.nextCheckAt).getTime() - Date.now(),
      });
    }

    const isRpcRateLimitError = (error) => {
      const message = `${error?.message || ""}`;
      return message.includes("429") || message.includes("Too Many Requests");
    };

    let verification;
    try {
      verification = await verifyQrSolTransfer({
        reference: intent.reference,
        receivingAddress: intent.merchantWalletAddress,
        amountLamports: intent.amountLamports,
        createdAt: intent.createdAt,
        fromWalletAddress: intent.fromWalletAddress,
      });
    } catch (error) {
      if (isRpcRateLimitError(error)) {
        const delayMs = 60 * 1000;
        intent.lastCheckedAt = new Date();
        intent.checkAttempts = (intent.checkAttempts || 0) + 1;
        intent.nextCheckAt = new Date(Date.now() + delayMs);
        await intent.save();

        return res.status(200).json({
          success: true,
          message: "Solana RPC is rate limited. Will retry shortly.",
          intent: serializePhantomDepositIntent(intent),
          retryAfterMs: delayMs,
          warningCode: "SOLANA_RPC_RATE_LIMITED",
        });
      }
      throw error;
    }

    intent.lastCheckedAt = new Date();
    intent.checkAttempts = (intent.checkAttempts || 0) + 1;
    
    // Backoff logic
    let nextDelayMs = 10 * 1000;
    if (intent.checkAttempts >= 6) nextDelayMs = 20 * 1000;
    if (intent.checkAttempts >= 12) nextDelayMs = 30 * 1000;
    
    intent.nextCheckAt = new Date(Date.now() + nextDelayMs);
    await intent.save();

    if (verification.valid) {
      let updatedIntent;
      try {
        updatedIntent = await confirmSolDepositAndCredit({
          intent,
          txSignature: verification.txSignature,
          verification,
        });
      } catch (err) {
        if (err.message === "DUPLICATE_DEPOSIT_SIGNATURE") {
          intent.status = "failed";
          intent.failureReason = "DUPLICATE_DEPOSIT_SIGNATURE";
          await intent.save();
          return res.status(409).json({
            success: false,
            errorCode: "DUPLICATE_DEPOSIT_SIGNATURE",
            message: "This transaction has already been used for another deposit.",
          });
        }
        throw err;
      }

      return res.status(200).json({
        success: true,
        message: "Payment detected and confirmed successfully.",
        intent: serializePhantomDepositIntent(updatedIntent),
      });
    }

    return res.status(200).json({
      success: true,
      message: verification.pending
        ? "Payment not found yet."
        : "Payment found but transaction did not match request.",
      intent: serializePhantomDepositIntent(intent),
    });
  } catch (error) {
    console.error("Get Phantom deposit status error:", error);

    return res.status(500).json({
      success: false,
      errorCode: "PHANTOM_DEPOSIT_STATUS_FAILED",
      message: "Unable to fetch deposit status right now.",
    });
  }
};

module.exports = {
  createPhantomDepositIntent,
  confirmPhantomDeposit,
  getPhantomDepositStatus,
};
