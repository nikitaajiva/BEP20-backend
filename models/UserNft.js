const mongoose = require("mongoose");

const UserNftSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    tierCode: {
      type: String,
      enum: ["N1", "N2", "N3", "N4", "N5"],
      required: true,
      index: true,
    },

    tierName: {
      type: String,
      required: true,
    },

    serialNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    mintPriceU: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    miningPower: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    powerCoefficient: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    poolMultiplierBeforeTsc: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    poolMultiplierAfterTsc: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    currentPoolMultiplier: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    dailyYieldRatePercent: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    tscAllocationAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    status: {
      type: String,
      enum: ["MINTED", "STAKED", "UNSTAKED", "BURNED"],
      default: "MINTED",
      index: true,
    },

    paymentAsset: {
      type: String,
      enum: ["SOL", "USDT", "APP_CREDIT"],
      default: "SOL",
    },

    paymentAmount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    mintedAt: {
      type: Date,
      default: Date.now,
    },

    stakedAt: {
      type: Date,
      default: null,
    },

    unstakedAt: {
      type: Date,
      default: null,
    },

    lastMinedAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    onChainMintAddress: {
      type: String,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

UserNftSchema.index({ user: 1, createdAt: -1 });
UserNftSchema.index({ user: 1, status: 1 });

module.exports =
  mongoose.models.UserNft || mongoose.model("UserNft", UserNftSchema);
