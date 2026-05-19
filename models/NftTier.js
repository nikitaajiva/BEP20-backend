const mongoose = require('mongoose');

const NftTierSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    enum: ['N1', 'N2', 'N3', 'N4', 'N5']
  },
  name: {
    type: String,
    required: true
  },
  mintPriceU: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  miningPower: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  powerCoefficient: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  poolMultiplierBeforeTsc: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  poolMultiplierAfterTsc: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  dailyYieldRatePercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  tscAllocationMode: {
    type: String,
    default: 'EQUIVALENT',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.models.NftTier || mongoose.model('NftTier', NftTierSchema);
