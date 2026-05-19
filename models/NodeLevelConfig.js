const mongoose = require('mongoose');

const NodeLevelConfigSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    enum: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']
  },
  upgradeMiningPower: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  totalMiningPower: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  miningOutputPercent: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  airdropAllocationPercent: {
    type: mongoose.Schema.Types.Decimal128,
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

module.exports = mongoose.models.NodeLevelConfig || mongoose.model('NodeLevelConfig', NodeLevelConfigSchema);
