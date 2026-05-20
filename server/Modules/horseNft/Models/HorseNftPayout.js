const mongoose = require("mongoose");

const HorseNftPayoutSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userHorseNft: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserHorseNft",
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
    payoutAsset: {
      type: String,
      default: "USDT",
      trim: true,
    },
    payoutAmountUSDT: {
      type: Number,
      required: true,
      min: 0,
    },
    payoutPeriodStart: {
      type: Date,
      required: true,
    },
    payoutPeriodEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "SKIPPED"],
      default: "PENDING",
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    failureReason: {
      type: String,
      default: null,
    },
    paidAt: {
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

HorseNftPayoutSchema.index({ user: 1, createdAt: -1 });
HorseNftPayoutSchema.index(
  { userHorseNft: 1, payoutPeriodStart: 1, payoutPeriodEnd: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.HorseNftPayout ||
  mongoose.model("HorseNftPayout", HorseNftPayoutSchema);
