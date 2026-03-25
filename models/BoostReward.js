const mongoose = require('mongoose');

const BoostRewardSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  rate: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },
  narrative: {
    type: String
  },
  creditProcessed: {
  type: Boolean,
  default: false,
  index: true
}
}, { timestamps: true });

module.exports = mongoose.model('BoostReward', BoostRewardSchema); 