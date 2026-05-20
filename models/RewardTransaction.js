const mongoose = require("mongoose");

const RewardTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    asset: {
      type: String,
      enum: ["TSC", "TKC"],
      required: true,
      index: true,
    },

    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "NFT_TSC_ALLOCATION",
        "NFT_MINING_REWARD",
        "REFERRAL_L1_REWARD",
        "REFERRAL_L2_REWARD",
        "NODE_REWARD",
        "ASSISTANCE_REWARD",
        "AIRDROP_REWARD",
        "TSC_WITHDRAWAL",
        "TSC_VESTING_LOCK",
        "TSC_VESTING_RELEASE",
        "TSC_TO_TKC_SWAP",
        "ADMIN_ADJUSTMENT",
        "HORSE_NFT_BONUS"
      ],
      required: true,
      index: true,
    },

    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },

    balanceField: {
      type: String,
      enum: ["tscAvailable", "tscLocked", "tscVesting", "tkc"],
      required: true,
    },

    referenceId: {
      type: String,
      default: null,
      index: true,
    },

    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    sourceUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    sourceNft: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserNft",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["POSTED", "REVERSED"],
      default: "POSTED",
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

RewardTransactionSchema.index({ user: 1, createdAt: -1 });
RewardTransactionSchema.index({ user: 1, asset: 1, type: 1, createdAt: -1 });

module.exports =
  mongoose.models.RewardTransaction ||
  mongoose.model("RewardTransaction", RewardTransactionSchema);
