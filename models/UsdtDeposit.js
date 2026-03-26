const mongoose = require("mongoose");

const UsdtDepositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  wallet_address: {
    type: String,
    required: true,
    trim: true,
  },
  tx_hash: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  amount: {
    type: String,
    required: true,
  },
  token_contract: {
    type: String,
    trim: true,
  },
  decimals: {
    type: Number,
  },
  network: {
    type: String,
    default: "BEP20",
  },
  ledgerTimestamp: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending_verification", "completed", "failed"],
    default: "pending_verification",
  },
  processingError: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("UsdtDeposit", UsdtDepositSchema);
