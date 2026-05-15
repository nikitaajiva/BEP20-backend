const mongoose = require("mongoose");

const phantomConnectSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    sessionTokenHash: {
      type: String,
      required: true,
      select: false,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "ready",
        "waiting_for_scan",
        "connected",
        "expired",
        "failed",
        "cancelled",
      ],
      default: "ready",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    dappEncryptionPublicKey: {
      type: String,
      required: true,
      trim: true,
    },
    dappEncryptionSecretKey: {
      type: String,
      required: true,
      select: false,
    },
    phantomEncryptionPublicKey: {
      type: String,
      default: null,
      trim: true,
    },
    phantomSession: {
      type: String,
      default: null,
      select: false,
    },
    walletAddress: {
      type: String,
      default: null,
      trim: true,
    },
    challengeMessage: {
      type: String,
      default: null,
      select: false,
    },
    challengeExpiresAt: {
      type: Date,
      default: null,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    errorCode: {
      type: String,
      default: "",
      trim: true,
    },
    errorMessage: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

phantomConnectSessionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.PhantomConnectSession ||
  mongoose.model("PhantomConnectSession", phantomConnectSessionSchema);
