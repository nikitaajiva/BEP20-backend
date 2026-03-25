const mongoose = require("mongoose");

const depositAddressSchema = new mongoose.Schema(
  {
    // XRPL wallet address where deposits are received
    wallet_address: {
      type: String,
      required: true,
      trim: true,
    },

    // Destination tag used to identify user deposits
    destination_tag: {
      type: Number,
      required: true,
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

    txHash: {
      type: String,
      trim: true,
    },

    amount_xrp: {
      type: Number,
      default: 0,
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
