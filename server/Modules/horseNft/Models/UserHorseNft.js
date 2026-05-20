const mongoose = require("mongoose");

const UserHorseNftSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    package: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HorseNftPackage",
      required: true,
    },
    tierCode: {
      type: String,
      enum: ["starter", "growth", "premium"],
      required: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    purchasePriceUSDT: {
      type: Number,
      required: true,
      min: 0,
    },
    bonusTokens: {
      type: Number,
      required: true,
      min: 0,
    },
    annualRoiPercent: {
      type: Number,
      required: true,
      min: 0,
    },
    dividendFrequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING_PAYMENT", "ACTIVE", "CANCELLED", "EXPIRED"],
      default: "PENDING_PAYMENT",
      index: true,
    },
    paymentAsset: {
      type: String,
      default: "USDT",
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },
    paymentReference: {
      type: String,
      default: null,
      trim: true,
    },
    purchasedAt: {
      type: Date,
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    nextPayoutAt: {
      type: Date,
      default: null,
      index: true,
    },
    totalPaidUSDT: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPayoutCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastPayoutAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

UserHorseNftSchema.index({ user: 1, status: 1 });
UserHorseNftSchema.index({ tierCode: 1, status: 1 });
UserHorseNftSchema.index({ user: 1, createdAt: -1 });

module.exports =
  mongoose.models.UserHorseNft ||
  mongoose.model("UserHorseNft", UserHorseNftSchema);
