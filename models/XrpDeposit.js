const mongoose = require('mongoose');

const XrpDepositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  walletAddress: { // The user's sending wallet address
    type: String,
    required: true,
    trim: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  amount: { // Amount in drops (string) as received from XRPL
    type: String,
    required: true
  },
  destinationTag: {
    type: String,
    trim: true
  },
  ledgerTimestamp: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending_verification', 'completed', 'failed'],
    default: 'pending_verification'
  },
  processingError: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('XrpDeposit', XrpDepositSchema); 