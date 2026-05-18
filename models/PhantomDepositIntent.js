const mongoose = require("mongoose");

const phantomDepositIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fromWalletAddress: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    merchantWalletAddress: {
      type: String,
      required: true,
      trim: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    amountSol: {
      type: Number,
      required: true,
      min: 0,
    },
    amountLamports: {
      type: Number,
      required: true,
      min: 1,
    },
    currency: {
      type: String,
      default: "SOL",
      enum: ["SOL"],
    },
    network: {
      type: String,
      default: "mainnet-beta",
    },
    status: {
      type: String,
      enum: ["created", "submitted", "confirmed", "failed", "expired"],
      default: "created",
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ["qr", "extension"],
      default: "extension",
    },
    txSignature: {
      type: String,
      default: null,
      index: true,
    },
    payerWalletAddress: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
    lastCheckedAt: {
      type: Date,
      default: null,
    },
    nextCheckAt: {
      type: Date,
      default: null,
    },
    checkAttempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

phantomDepositIntentSchema.index({ user: 1, createdAt: -1 });
phantomDepositIntentSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model(
  "PhantomDepositIntent",
  phantomDepositIntentSchema
);
