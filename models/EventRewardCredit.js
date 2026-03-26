// models/EventRewardCredit.js
const mongoose = require("mongoose");

const EventRewardCreditSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: true,
    },
    // UTC date string: "2025-12-09"
    date: {
      type: String,
      index: true,
      required: true,
    },
    // Event name (for Macau / Hong Kong campaign)
    event: {
      type: String,
      default: "MACAU_HK_EVENT",
      index: true,
    },
    // Total rewards credited for that user on that date for this event
    credited: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    // How much of credited has been redeemed (consumed) by event logic
    redeemed: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      default: "0",
    },
    // Remaining event balance = credited - redeemed
    remaining: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
  },
  { timestamps: true }
);

// One document per (user + date + event)
EventRewardCreditSchema.index({ userId: 1, date: 1, event: 1 }, { unique: true });

module.exports = mongoose.model("EventRewardCredit", EventRewardCreditSchema);
