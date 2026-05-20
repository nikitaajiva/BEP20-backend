const mongoose = require("mongoose");

const HorseNftPackageSchema = new mongoose.Schema(
  {
    tierCode: {
      type: String,
      enum: ["starter", "growth", "premium"],
      required: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    tierName: {
      type: String,
      required: true,
      trim: true,
    },
    priceUSDT: {
      type: Number,
      required: true,
      min: 0,
    },
    bonusTokens: {
      type: Number,
      required: true,
      min: 0,
    },
    annualRoiPercent: {
      type: Number,
      required: true,
      min: 0,
    },
    dividendFrequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly"],
      required: true,
    },
    benefits: {
      type: [String],
      default: [],
    },
    imageKey: {
      type: String,
      default: null,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

HorseNftPackageSchema.index({ isActive: 1, sortOrder: 1 });

module.exports =
  mongoose.models.HorseNftPackage ||
  mongoose.model("HorseNftPackage", HorseNftPackageSchema);
