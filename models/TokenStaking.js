const mongoose = require("mongoose");

const TokenStakingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      default: 0,
    },

    days: {
      type: Number,
      enum: [30, 90, 180, 365],
      required: true,
      index: true,
    },

    startDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
      index: true,
    },

    apy: {
      type: Number,
      required: true,
      default: 0.10,
    },

    tokenAmount: {
      type: Number,
      default: 0,
    },

    earnedRewards: {
      type: Number,
      default: 0, // Track cumulative daily yields/rewards earned so far
    },

    lastRewardedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

TokenStakingSchema.index({ user: 1, status: 1 });
TokenStakingSchema.index({ user: 1, createdAt: -1 });

module.exports =
  mongoose.models.TokenStaking || mongoose.model("TokenStaking", TokenStakingSchema);
