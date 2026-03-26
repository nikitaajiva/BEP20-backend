const mongoose = require("mongoose");

const UsdtDepositIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    wallet_address: {
      type: String,
      trim: true,
      required: true,
    },
    deposit_address: {
      type: String,
      trim: true,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    referenceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tx_hash: {
      type: String,
      trim: true,
    },
    network: {
      type: String,
      default: "BEP20",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "expired", "failed"],
      default: "pending",
    },
    processingError: {
      type: String,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UsdtDepositIntent", UsdtDepositIntentSchema);
