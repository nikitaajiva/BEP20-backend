const mongoose = require("mongoose");

const PhantomDepositIntentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      unique: true,
    },
    amount: {
      type: String, // Amount in SOL
      required: true,
    },
    solPayUrl: {
      type: String,
    },
    tx_hash: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ["created", "pending", "submitted", "completed", "failed", "expired"],
      default: "created",
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
    },
    processingError: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-expire indexing
PhantomDepositIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PhantomDepositIntent", PhantomDepositIntentSchema);
