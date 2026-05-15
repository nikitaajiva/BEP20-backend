const crypto = require("crypto");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const PhantomConnectSession = require("../models/PhantomConnectSession");
const {
  PhantomAuthError,
  issuePhantomChallengeForUser,
  verifyAndConnectPhantomForUser,
} = require("../utils/phantomWalletAuth");

const SESSION_TTL_MS = 2 * 60 * 1000;
const ACTIVE_STATUSES = ["ready", "waiting_for_scan"];

const getBs58 = () => bs58.default || bs58;

const hashSessionToken = (sessionToken) =>
  crypto.createHash("sha256").update(sessionToken).digest("hex");

const isExpired = (session) =>
  !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now();

const buildPublicSessionResponse = (session, user = null) => ({
  id: session.sessionId,
  status: session.status,
  expiresAt: session.expiresAt,
  walletAddress: session.walletAddress || "",
  connectedAt: session.connectedAt || null,
  errorCode: session.errorCode || "",
  errorMessage: session.errorMessage || "",
  user: user || session.user || undefined,
});

const expireSessionIfNeeded = async (session) => {
  if (!session || !isExpired(session) || ["connected", "cancelled"].includes(session.status)) {
    return session;
  }

  if (session.status !== "expired") {
    session.status = "expired";
    session.errorCode = "PHANTOM_QR_SESSION_EXPIRED";
    session.errorMessage = "QR session expired. Please generate a new code.";
    await session.save();
  }

  return session;
};

const getSessionForUser = async (userId, sessionId) => {
  const session = await PhantomConnectSession.findOne({
    sessionId,
    user: userId,
  }).populate("user", "-password");

  if (!session) {
    throw new PhantomAuthError(404, "PHANTOM_QR_SESSION_NOT_FOUND", "QR session not found.");
  }

  return expireSessionIfNeeded(session);
};

const getSessionByToken = async (sessionId, sessionToken, withSecrets = false) => {
  if (!sessionToken) {
    throw new PhantomAuthError(
      401,
      "PHANTOM_QR_SESSION_TOKEN_REQUIRED",
      "QR session token is required."
    );
  }

  const query = PhantomConnectSession.findOne({
    sessionId,
    sessionTokenHash: hashSessionToken(sessionToken),
  });

  if (withSecrets) {
    query.select(
      "+sessionTokenHash +dappEncryptionSecretKey +phantomSession +challengeMessage"
    );
  } else {
    query.select("+sessionTokenHash");
  }

  const session = await query.populate("user", "-password");

  if (!session) {
    throw new PhantomAuthError(
      404,
      "PHANTOM_QR_SESSION_NOT_FOUND",
      "QR session not found or has expired."
    );
  }

  return expireSessionIfNeeded(session);
};

const cancelActiveSessionsForUser = async (userId) => {
  await PhantomConnectSession.updateMany(
    {
      user: userId,
      status: { $in: ACTIVE_STATUSES },
    },
    {
      $set: {
        status: "cancelled",
        errorCode: "PHANTOM_QR_SESSION_REPLACED",
        errorMessage: "Session replaced by a newer QR code.",
        cancelledAt: new Date(),
      },
    }
  );
};

const createPhantomQrSession = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({
        success: false,
        errorCode: "AUTH_REQUIRED",
        message: "Authentication required.",
      });
    }

    await cancelActiveSessionsForUser(req.user._id);

    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const keypair = nacl.box.keyPair();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const session = await PhantomConnectSession.create({
      sessionId,
      sessionTokenHash: hashSessionToken(sessionToken),
      user: req.user._id,
      expiresAt,
      status: "ready",
      dappEncryptionPublicKey: getBs58().encode(keypair.publicKey),
      dappEncryptionSecretKey: getBs58().encode(keypair.secretKey),
      errorCode: "",
      errorMessage: "",
    });

    return res.status(201).json({
      success: true,
      session: {
        id: session.sessionId,
        status: session.status,
        expiresAt: session.expiresAt,
        sessionToken,
      },
    });
  } catch (error) {
    console.error("Create Phantom QR session error:", error);
    return res.status(500).json({
      success: false,
      errorCode: "PHANTOM_QR_SESSION_CREATE_FAILED",
      message: "Unable to create Phantom QR session right now.",
    });
  }
};

const getPhantomQrSession = async (req, res) => {
  try {
    const session = await getSessionForUser(req.user?._id, req.params.sessionId);
    return res.status(200).json({
      success: true,
      session: buildPublicSessionResponse(session, session.user),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_SESSION_FETCH_FAILED",
      message: error.message || "Unable to fetch QR session.",
    });
  }
};

const bootstrapPhantomQrSession = async (req, res) => {
  try {
    const session = await getSessionByToken(
      req.params.sessionId,
      req.body?.sessionToken,
      true
    );

    if (session.status === "cancelled") {
      throw new PhantomAuthError(
        409,
        "PHANTOM_QR_SESSION_CANCELLED",
        session.errorMessage || "QR session was cancelled."
      );
    }

    if (session.status === "connected") {
      return res.status(200).json({
        success: true,
        session: {
          ...buildPublicSessionResponse(session, session.user),
          dappEncryptionPublicKey: session.dappEncryptionPublicKey,
          dappEncryptionSecretKey: session.dappEncryptionSecretKey,
          phantomEncryptionPublicKey: session.phantomEncryptionPublicKey || "",
          walletAddress: session.walletAddress || "",
          challengeMessage: session.challengeMessage || "",
          phantomSession: session.phantomSession || "",
        },
      });
    }

    if (session.status === "ready") {
      session.status = "waiting_for_scan";
      session.errorCode = "";
      session.errorMessage = "";
      await session.save();
    }

    return res.status(200).json({
      success: true,
      session: {
        ...buildPublicSessionResponse(session, session.user),
        dappEncryptionPublicKey: session.dappEncryptionPublicKey,
        dappEncryptionSecretKey: session.dappEncryptionSecretKey,
        phantomEncryptionPublicKey: session.phantomEncryptionPublicKey || "",
        walletAddress: session.walletAddress || "",
        challengeMessage: session.challengeMessage || "",
        phantomSession: session.phantomSession || "",
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_SESSION_BOOTSTRAP_FAILED",
      message: error.message || "Unable to prepare QR session.",
    });
  }
};

const createPhantomQrChallenge = async (req, res) => {
  try {
    const session = await getSessionByToken(
      req.params.sessionId,
      req.body?.sessionToken,
      true
    );

    if (["cancelled", "connected", "expired"].includes(session.status)) {
      throw new PhantomAuthError(
        409,
        "PHANTOM_QR_SESSION_NOT_ACTIVE",
        "QR session is no longer active."
      );
    }

    const walletAddress = `${req.body?.walletAddress || ""}`.trim();
    const phantomSession = `${req.body?.phantomSession || ""}`.trim();
    const phantomEncryptionPublicKey = `${req.body?.phantomEncryptionPublicKey || ""}`.trim();

    const challenge = await issuePhantomChallengeForUser({
      userId: session.user._id,
      walletAddress,
    });

    session.walletAddress = walletAddress;
    session.challengeMessage = challenge.message;
    session.challengeExpiresAt = challenge.nonceExpiresAt;
    session.phantomSession = phantomSession || session.phantomSession || null;
    session.phantomEncryptionPublicKey =
      phantomEncryptionPublicKey || session.phantomEncryptionPublicKey || null;
    session.status = "waiting_for_scan";
    session.errorCode = "";
    session.errorMessage = "";
    await session.save();

    return res.status(200).json({
      success: true,
      message: challenge.message,
      nonceExpiresAt: challenge.nonceExpiresAt,
      walletAddress: session.walletAddress,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_CHALLENGE_FAILED",
      message: error.message || "Unable to create wallet verification challenge.",
    });
  }
};

const verifyAndConnectPhantomQr = async (req, res) => {
  try {
    const session = await getSessionByToken(
      req.params.sessionId,
      req.body?.sessionToken,
      true
    );

    if (session.status === "connected") {
      return res.status(200).json({
        success: true,
        message: "Phantom wallet connected successfully.",
        phantomWalletAddress: session.walletAddress,
        phantomWalletConnectedAt: session.connectedAt,
        user: session.user,
      });
    }

    if (["cancelled", "expired"].includes(session.status)) {
      throw new PhantomAuthError(
        409,
        "PHANTOM_QR_SESSION_NOT_ACTIVE",
        "QR session is no longer active."
      );
    }

    if (!session.walletAddress || !session.challengeMessage) {
      throw new PhantomAuthError(
        400,
        "PHANTOM_QR_CHALLENGE_MISSING",
        "Wallet verification challenge is missing. Please restart the QR flow."
      );
    }

    const result = await verifyAndConnectPhantomForUser({
      userId: session.user._id,
      walletAddress: session.walletAddress,
      signature: req.body?.signature,
      message: session.challengeMessage,
    });

    session.status = "connected";
    session.connectedAt = result.phantomWalletConnectedAt;
    session.completedAt = new Date();
    session.errorCode = "";
    session.errorMessage = "";
    await session.save();

    return res.status(200).json({
      success: true,
      message: "Phantom wallet connected successfully.",
      phantomWalletAddress: result.walletAddress,
      phantomWalletConnectedAt: result.phantomWalletConnectedAt,
      user: result.updatedUser,
    });
  } catch (error) {
    if (error instanceof PhantomAuthError) {
      try {
        const session = await getSessionByToken(
          req.params.sessionId,
          req.body?.sessionToken,
          true
        );
        session.status = "failed";
        session.errorCode = error.errorCode || "PHANTOM_QR_VERIFY_FAILED";
        session.errorMessage =
          error.message || "Unable to verify Phantom wallet right now.";
        session.failedAt = new Date();
        await session.save();
      } catch (sessionError) {
        console.error("Phantom QR verify session update error:", sessionError);
      }
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_VERIFY_FAILED",
      message: error.message || "Unable to verify Phantom wallet right now.",
    });
  }
};

const updatePhantomQrSessionStatus = async (req, res) => {
  try {
    const session = await getSessionByToken(
      req.params.sessionId,
      req.body?.sessionToken,
      true
    );

    if (session.status === "connected") {
      return res.status(200).json({
        success: true,
        session: buildPublicSessionResponse(session, session.user),
      });
    }

    const requestedStatus = `${req.body?.status || ""}`.trim();
    const nextStatus =
      requestedStatus === "cancelled" ? "cancelled" : "failed";

    session.status = nextStatus;
    session.errorCode = `${req.body?.errorCode || ""}`.trim();
    session.errorMessage =
      `${req.body?.errorMessage || ""}`.trim() ||
      (nextStatus === "cancelled"
        ? "Wallet connection was cancelled."
        : "Wallet connection failed.");
    session.failedAt = nextStatus === "failed" ? new Date() : session.failedAt;
    session.cancelledAt =
      nextStatus === "cancelled" ? new Date() : session.cancelledAt;
    await session.save();

    return res.status(200).json({
      success: true,
      session: buildPublicSessionResponse(session, session.user),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_SESSION_STATUS_FAILED",
      message: error.message || "Unable to update QR session status.",
    });
  }
};

const cancelPhantomQrSession = async (req, res) => {
  try {
    const session = await getSessionForUser(req.user?._id, req.params.sessionId);

    if (session.status !== "connected") {
      session.status = "cancelled";
      session.errorCode = "PHANTOM_QR_SESSION_CANCELLED";
      session.errorMessage = "Wallet connection cancelled.";
      session.cancelledAt = new Date();
      await session.save();
    }

    return res.status(200).json({
      success: true,
      session: buildPublicSessionResponse(session, session.user),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      errorCode: error.errorCode || "PHANTOM_QR_SESSION_CANCEL_FAILED",
      message: error.message || "Unable to cancel QR session.",
    });
  }
};

module.exports = {
  bootstrapPhantomQrSession,
  cancelPhantomQrSession,
  createPhantomQrChallenge,
  createPhantomQrSession,
  getPhantomQrSession,
  updatePhantomQrSessionStatus,
  verifyAndConnectPhantomQr,
};
