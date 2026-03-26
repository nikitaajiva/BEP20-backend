const mongoose = require("mongoose");

const depositAddressSchema = new mongoose.Schema(
  {
    // BEP20 wallet address where deposits are received
    wallet_address: {
      type: String,
      required: true,
      trim: true,
    },

    // Mark active address for current system use
    isActive: {
      type: Boolean,
      default: true,
    },

    // Optional fields populated after deposit detection
    source_address: {
      type: String,
      trim: true,
    },

    tx_hash: {
      type: String,
      trim: true,
    },

    amount: {
      type: Number,
      default: 0,
    },

    network: {
      type: String,
      default: "BEP20",
    },
  },
  { timestamps: true }
);

// ✅ Optional: enforce only one active deposit address at a time
depositAddressSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model("DepositAddress", depositAddressSchema);
