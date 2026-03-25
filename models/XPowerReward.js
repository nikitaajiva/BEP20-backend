// models/XPowerReward.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const xPowerRewardSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User", // Sponsor who receives reward
      required: true,
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: "User", // User who triggered reward (downline)
      required: true,
    },
    xRank: {
      type: String,
      required: true, // Sponsor's xRank at the time of reward
    },
    tier: {
      type: String,
      required: true, // x1reward.tier that triggered this reward
    },
    amount: {
      type: Schema.Types.Decimal128,
      required: true, // 7% of x1reward.amount
    },
    level: {
      type: Number,
      enum: [1, 2, 3], // Sponsor level (1st, 2nd, 3rd upline)
      required: true,
    },
    sourceRewardId: {
      type: Schema.Types.ObjectId,
      ref: "X1Reward", // Link back to original x1reward
      required: true,
    },
    ts: {
      type: Date,
      default: Date.now, // Timestamp of reward creation
    },
  },
  { timestamps: true } // adds createdAt, updatedAt
);

module.exports = mongoose.model("XPowerReward", xPowerRewardSchema);
