const mongoose = require("mongoose");

const MiningSnapshotSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userNft: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserNft",
      required: true,
      index: true,
    },
    tierCode: {
      type: String,
      enum: ["N1", "N2", "N3", "N4", "N5"],
      required: true,
    },
    miningDate: {
      type: String, // format: YYYY-MM-DD
      required: true,
      index: true,
    },
    miningPower: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    tscAllocationAmount: {
      type: mongoose.Schema.Types.Decimal128,
    },
    dailyYieldRatePercent: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    powerCoefficient: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    poolMultiplier: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    minedTsc: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    formula: {
      type: String,
    },
    status: {
      type: String,
      enum: ["POSTED", "REVERSED"],
      default: "POSTED",
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Indexes
MiningSnapshotSchema.index({ userNft: 1, miningDate: 1 }, { unique: true });
MiningSnapshotSchema.index({ user: 1, miningDate: -1 });
MiningSnapshotSchema.index({ miningDate: -1 });

module.exports =
  mongoose.models.MiningSnapshot ||
  mongoose.model("MiningSnapshot", MiningSnapshotSchema);
