// models/EcosystemFee.js
const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const EcosystemFeeSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    ts: {
      type: Date,
      default: Date.now,
      index: true
    },
    amount: {
      type: Schema.Types.Decimal128,
      required: true
    },
    walletFrom: {
      type: String,
      required: true,
      enum: ["SWIFT", "LP", "BOOST", "COMMUNITY_REWARDS", "USDT", "ZERO_RISK"]
    },
    eventType: {
      type: String,
      default: "ECOSYSTEM_FEE"
    },
    ledgerRefId: {
      type: String, // optional: to group by batch runs
      index: true
    },
    refId: {
      // Reference to related documents, e.g., transaction hash, parent ledger row ID for cascades
      type: String,
      index: true,
    },
    narrative: {
      type: String,
      default: "Ecosystem fee deducted during autopositioning"
    }
  },
  {
    timestamps: { createdAt: "ts" }
  }
);

module.exports = mongoose.models.EcosystemFee || mongoose.model("EcosystemFee", EcosystemFeeSchema);
