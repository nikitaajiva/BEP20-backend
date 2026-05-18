const crypto = require("crypto");
const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} = require("@solana/web3.js");

const PhantomDepositIntent = require("../models/PhantomDepositIntent");
const { upsertDepositLedgerRow } = require("../services/depositService");

const getConnection = () => {
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");
  return new Connection(rpcUrl, "confirmed");
};

const isUsingConnectedWalletAsTreasury = () => {
  return `${process.env.SOLANA_USE_CONNECTED_WALLET_AS_TREASURY || ""}`
    .trim()
    .toLowerCase() === "true";
};

const getDepositReceivingAddress = (connectedWalletAddress) => {
  const useConnectedWallet = isUsingConnectedWalletAsTreasury();

  const address = useConnectedWallet
    ? `${connectedWalletAddress || ""}`.trim()
    : `${process.env.SOLANA_TREASURY_ADDRESS || ""}`.trim();

  if (!address) {
    throw new Error(
      useConnectedWallet
        ? "CONNECTED_WALLET_ADDRESS_NOT_FOUND"
        : "SOLANA_TREASURY_ADDRESS_NOT_CONFIGURED"
    );
  }

  try {
    return new PublicKey(address).toBase58();
  } catch {
    throw new Error(
      useConnectedWallet
        ? "INVALID_CONNECTED_WALLET_ADDRESS"
        : "INVALID_SOLANA_TREASURY_ADDRESS"
    );
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

    const temporaryConnectedWalletMode = isUsingConnectedWalletAsTreasury();
    const treasuryAddress = getDepositReceivingAddress(walletAddress);
    const reference = createReference();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const intent = await PhantomDepositIntent.create({
      user: req.user._id,
      fromWalletAddress: walletAddress,
      treasuryAddress,
      reference,
      amountSol: parsedAmount.amountSol,
      amountLamports: parsedAmount.amountLamports,
      network: process.env.SOLANA_NETWORK || "mainnet-beta",
      paymentMethod,
      status: "created",
      expiresAt,
    });

    const solanaPayUrl = new URL(`solana:${treasuryAddress}`);
    solanaPayUrl.searchParams.set("amount", String(parsedAmount.amountSol));
    solanaPayUrl.searchParams.set("reference", reference);
    solanaPayUrl.searchParams.set("label", process.env.APP_NAME || "BEPVault");
    solanaPayUrl.searchParams.set(
      "message",
      temporaryConnectedWalletMode
        ? `Request ${parsedAmount.amountSol} SOL`
        : `Deposit ${parsedAmount.amountSol} SOL`
    );
    solanaPayUrl.searchParams.set("memo", `phantom-deposit:${intent._id}`);

    return res.status(201).json({
      success: true,
      intent: {
        id: intent._id,
        fromWalletAddress: walletAddress,
        treasuryAddress,
        receivingAddress: treasuryAddress,
        reference,
        amountSol: intent.amountSol,
        amountLamports: intent.amountLamports,
        currency: "SOL",
        network: intent.network,
        status: intent.status,
        paymentMethod: intent.paymentMethod,
        expiresAt: intent.expiresAt,
        temporaryConnectedWalletMode,
      },
      solanaPayUrl: solanaPayUrl.toString(),
    });
  } catch (error) {
    console.error("Create Phantom deposit intent error:", error);

    const depositAddressErrors = [
      "SOLANA_TREASURY_ADDRESS_NOT_CONFIGURED",
      "INVALID_SOLANA_TREASURY_ADDRESS",
      "CONNECTED_WALLET_ADDRESS_NOT_FOUND",
      "INVALID_CONNECTED_WALLET_ADDRESS",
    ];

    if (depositAddressErrors.includes(error.message)) {
      return res.status(500).json({
        success: false,
        errorCode: error.message,
        message:
          error.message === "CONNECTED_WALLET_ADDRESS_NOT_FOUND"
            ? "Connected Phantom wallet address was not found."
            : error.message === "INVALID_CONNECTED_WALLET_ADDRESS"
            ? "Connected Phantom wallet address is invalid."
            : error.message === "SOLANA_TREASURY_ADDRESS_NOT_CONFIGURED"
            ? "Solana treasury address is not configured."
            : "Solana treasury address is invalid.",
      });
    }

    return res.status(500).json({
      success: false,
      errorCode: error.message || "PHANTOM_DEPOSIT_INTENT_FAILED",
      message: "Unable to create deposit request right now.",
    });
  }
};

const verifySolTransfer = async ({
  txSignature,
  fromWalletAddress,
  treasuryAddress,
  amountLamports,
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

  const instructions = tx.transaction.message.instructions || [];

  const hasTransfer = instructions.some((instruction) => {
    if (instruction.program !== "system") return false;

    const parsed = instruction.parsed;
    if (!parsed || parsed.type !== "transfer") return false;

    const info = parsed.info || {};

    return (
      info.source === fromWalletAddress &&
      info.destination === treasuryAddress &&
      Number(info.lamports) >= Number(amountLamports)
    );
  });

  if (!hasTransfer) {
    return {
      valid: false,
      reason: "MATCHING_SOL_TRANSFER_NOT_FOUND",
    };
  }

  return {
    valid: true,
    tx,
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
        message:
          intent.status === "confirmed"
            ? "Deposit already confirmed."
            : "Deposit is no longer active.",
        intent,
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

    intent.status = "submitted";
    intent.txSignature = txSignature;
    await intent.save();

    const verification = await verifySolTransfer({
      txSignature,
      fromWalletAddress: intent.fromWalletAddress,
      treasuryAddress: intent.treasuryAddress,
      amountLamports: intent.amountLamports,
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

    intent.status = "confirmed";
    intent.confirmedAt = new Date();
    await intent.save();

    await upsertDepositLedgerRow({
      userId: req.user._id,
      referenceId: intent._id.toString(),
      txHash: txSignature,
      amount: intent.amountSol,
      status: "COMPLETED",
      eventType: "DEPOSIT",
      walletTo: "SOL",
      asset: "SOL",
      network: "SOLANA",
      narrative: `SOL deposit confirmed: ${intent.amountSol} SOL`,
    });

    return res.status(200).json({
      success: true,
      message: "Deposit confirmed successfully.",
      intent: {
        id: intent._id,
        status: intent.status,
        amountSol: intent.amountSol,
        amountLamports: intent.amountLamports,
        currency: intent.currency,
        txSignature: intent.txSignature,
        confirmedAt: intent.confirmedAt,
      },
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

const verifyQrSolTransfer = async ({
  reference,
  receivingAddress,
  amountLamports,
}) => {
  const found = await findTransactionByReference({ reference });

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
        intent: {
          id: intent._id,
          status: intent.status,
          amountSol: intent.amountSol,
          amountLamports: intent.amountLamports,
          currency: intent.currency,
          txSignature: intent.txSignature,
          payerWalletAddress: intent.payerWalletAddress || null,
          expiresAt: intent.expiresAt,
          confirmedAt: intent.confirmedAt,
        },
      });
    }

    if (["failed", "expired"].includes(intent.status)) {
      return res.status(200).json({
        success: true,
        intent: {
          id: intent._id,
          status: intent.status,
          amountSol: intent.amountSol,
          amountLamports: intent.amountLamports,
          currency: intent.currency,
          txSignature: intent.txSignature,
          failureReason: intent.failureReason,
          expiresAt: intent.expiresAt,
          confirmedAt: intent.confirmedAt,
        },
      });
    }

    if (new Date(intent.expiresAt).getTime() < Date.now()) {
      intent.status = "expired";
      intent.failureReason = "Deposit request expired.";
      await intent.save();

      return res.status(200).json({
        success: true,
        intent: {
          id: intent._id,
          status: intent.status,
          amountSol: intent.amountSol,
          amountLamports: intent.amountLamports,
          currency: intent.currency,
          failureReason: intent.failureReason,
          expiresAt: intent.expiresAt,
          confirmedAt: intent.confirmedAt,
        },
      });
    }

    // Auto-detect QR/Solana Pay payment by reference.
    const verification = await verifyQrSolTransfer({
      reference: intent.reference,
      receivingAddress: intent.treasuryAddress,
      amountLamports: intent.amountLamports,
    });

    if (verification.valid) {
      const duplicate = await PhantomDepositIntent.findOne({
        txSignature: verification.txSignature,
        _id: { $ne: intent._id },
      }).select("_id");

      if (duplicate) {
        intent.status = "failed";
        intent.failureReason = "DUPLICATE_DEPOSIT_SIGNATURE";
        await intent.save();

        return res.status(409).json({
          success: false,
          errorCode: "DUPLICATE_DEPOSIT_SIGNATURE",
          message: "This transaction has already been used for another deposit.",
        });
      }

      intent.status = "confirmed";
      intent.txSignature = verification.txSignature;
      intent.payerWalletAddress = verification.payerWalletAddress || null;
      intent.confirmedAt = new Date();
      await intent.save();

      // In temporary request-money mode, do NOT credit internal balance unless your business rules require it.
      // For production treasury deposits, credit ledger here only after verified.
      // If ledger credit already exists, keep it idempotent.

      return res.status(200).json({
        success: true,
        message: "Payment detected and confirmed successfully.",
        intent: {
          id: intent._id,
          status: intent.status,
          amountSol: intent.amountSol,
          amountLamports: intent.amountLamports,
          currency: intent.currency,
          txSignature: intent.txSignature,
          payerWalletAddress: intent.payerWalletAddress || null,
          expiresAt: intent.expiresAt,
          confirmedAt: intent.confirmedAt,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: verification.pending
        ? "Payment not found yet."
        : "Payment found but transaction did not match request.",
      intent: {
        id: intent._id,
        status: intent.status,
        amountSol: intent.amountSol,
        amountLamports: intent.amountLamports,
        currency: intent.currency,
        txSignature: intent.txSignature,
        failureReason: intent.failureReason,
        expiresAt: intent.expiresAt,
        confirmedAt: intent.confirmedAt,
      },
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
