const mongoose = require("mongoose");

const BnbDepositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  wallet_address: {
    type: String,
    trim: true,
  },
  from_address: {
    type: String,
    trim: true,
  },
  to_address: {
    type: String,
    trim: true,
  },
  tx_hash: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  referenceId: {
    type: String,
    index: true,
  },
  amount: {
    type: String,
    required: true,
  },
  amount_wei: {
    type: String,
  },
  decimals: {
    type: Number,
    default: 18,
  },
  block_number: {
    type: Number,
  },
  tx_timestamp: {
    type: Date,
  },
  tx_metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
  tx_raw: {
    type: mongoose.Schema.Types.Mixed,
  },
  receipt_raw: {
    type: mongoose.Schema.Types.Mixed,
  },
  network: {
    type: String,
    default: "BSC",
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

module.exports = mongoose.model("BnbDeposit", BnbDepositSchema);
