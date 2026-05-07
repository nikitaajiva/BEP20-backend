const mongoose = require("mongoose");

const BnbTransactionSchema = new mongoose.Schema(
  {
    txHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    from: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    to: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    valueWei: {
      type: String,
      required: true,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    blockNumber: {
      type: Number,
    },
    transactionIndex: {
      type: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BnbTransaction", BnbTransactionSchema);
