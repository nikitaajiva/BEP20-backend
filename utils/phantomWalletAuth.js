const crypto = require("crypto");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { PublicKey } = require("@solana/web3.js");
const User = require("../models/User");

const APP_NAME = process.env.APP_NAME || "BEPVault";

class PhantomAuthError extends Error {
  constructor(statusCode, errorCode, message) {
    super(message);
    this.name = "PhantomAuthError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const getBs58 = () => bs58.default || bs58;

const normalizeSignatureBytes = (signature) => {
  if (Array.isArray(signature)) {
    return Uint8Array.from(signature);
  }

  if (typeof signature === "string") {
    return getBs58().decode(signature);
  }

  throw new PhantomAuthError(
    400,
    "INVALID_SIGNATURE_FORMAT",
    "Invalid wallet signature format."
  );
};

const assertValidSolanaPublicKey = (walletAddress) => {
  try {
    return new PublicKey(walletAddress);
  } catch {
    throw new PhantomAuthError(
      400,
      "INVALID_SOLANA_WALLET_ADDRESS",
      "Invalid Solana wallet address."
    );
  }
};

const buildPhantomChallengeMessage = ({ walletAddress, userId }) => {
  const nonce = crypto.randomBytes(32).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const message = [
    `${APP_NAME} wants to connect your Phantom wallet.`,
    "",
    "Purpose: Connect Phantom Wallet",
    `Wallet: ${walletAddress}`,
    `User ID: ${userId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Only sign this message if you trust this application.",
  ].join("\n");

  return { nonce, issuedAt, expiresAt, message };
};

const clearWalletChallenge = async (userId) => {
  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        walletAuthNonce: null,
        walletAuthNonceExpiresAt: null,
      },
    },
    {
      runValidators: false,
    }
  );
};

const issuePhantomChallengeForUser = async ({ userId, walletAddress }) => {
  assertValidSolanaPublicKey(walletAddress);

  const { nonce, expiresAt, message } = buildPhantomChallengeMessage({
    walletAddress,
    userId,
  });

  await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        walletAuthNonce: nonce,
        walletAuthNonceExpiresAt: expiresAt,
      },
    },
    {
      runValidators: false,
    }
  );

  return {
    message,
    nonce,
    nonceExpiresAt: expiresAt,
  };
};

const verifyAndConnectPhantomForUser = async ({
  userId,
  walletAddress,
  signature,
  message,
}) => {
  if (!walletAddress || !signature || !message) {
    throw new PhantomAuthError(
      400,
      "PHANTOM_VERIFY_PAYLOAD_INVALID",
      "Wallet address, signature, and message are required."
    );
  }

  const publicKey = assertValidSolanaPublicKey(walletAddress);

  const freshUser = await User.findById(userId).select(
    "+walletAuthNonce +walletAuthNonceExpiresAt"
  );

  if (!freshUser) {
    throw new PhantomAuthError(401, "AUTH_REQUIRED", "User not found.");
  }

  if (!freshUser.walletAuthNonce || !freshUser.walletAuthNonceExpiresAt) {
    throw new PhantomAuthError(
      400,
      "PHANTOM_CHALLENGE_MISSING",
      "Wallet verification challenge is missing. Please try again."
    );
  }

  if (new Date(freshUser.walletAuthNonceExpiresAt).getTime() < Date.now()) {
    await clearWalletChallenge(freshUser._id);
    throw new PhantomAuthError(
      400,
      "PHANTOM_CHALLENGE_EXPIRED",
      "Wallet verification challenge expired. Please try again."
    );
  }

  if (!message.includes(`Nonce: ${freshUser.walletAuthNonce}`)) {
    throw new PhantomAuthError(
      400,
      "PHANTOM_NONCE_MISMATCH",
      "Wallet verification challenge is invalid."
    );
  }

  if (!message.includes(`Wallet: ${walletAddress}`)) {
    throw new PhantomAuthError(
      400,
      "PHANTOM_WALLET_MISMATCH",
      "Wallet address does not match the signed message."
    );
  }

  if (!message.includes(`User ID: ${freshUser._id}`)) {
    throw new PhantomAuthError(
      400,
      "PHANTOM_USER_MISMATCH",
      "Signed message does not belong to this user."
    );
  }

  const existingWalletUser = await User.findOne({
    phantomWalletAddress: walletAddress,
    _id: {
      $ne: freshUser._id,
    },
  }).select("_id");

  if (existingWalletUser) {
    throw new PhantomAuthError(
      409,
      "PHANTOM_WALLET_ALREADY_LINKED",
      "This Phantom wallet is already connected to another account."
    );
  }

  const signatureBytes = normalizeSignatureBytes(signature);
  const messageBytes = new TextEncoder().encode(message);
  const isValid = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKey.toBytes()
  );

  if (!isValid) {
    throw new PhantomAuthError(
      401,
      "PHANTOM_SIGNATURE_INVALID",
      "Wallet signature verification failed."
    );
  }

  const connectedAt = new Date();
  const updatedUser = await User.findByIdAndUpdate(
    freshUser._id,
    {
      $set: {
        phantomWalletAddress: walletAddress,
        phantomWalletConnectedAt: connectedAt,
        walletAuthNonce: null,
        walletAuthNonceExpiresAt: null,
      },
    },
    {
      new: true,
      runValidators: false,
    }
  ).select("-password");

  return {
    updatedUser,
    walletAddress: updatedUser?.phantomWalletAddress || walletAddress,
    phantomWalletConnectedAt:
      updatedUser?.phantomWalletConnectedAt || connectedAt,
  };
};

module.exports = {
  PhantomAuthError,
  assertValidSolanaPublicKey,
  buildPhantomChallengeMessage,
  clearWalletChallenge,
  getBs58,
  issuePhantomChallengeForUser,
  normalizeSignatureBytes,
  verifyAndConnectPhantomForUser,
};
