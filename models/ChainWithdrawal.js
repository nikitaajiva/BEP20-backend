const mongoose = require('mongoose');

const { Schema } = mongoose;

// Schema for on-chain withdrawals captured by trackChainTx.js
const ChainWithdrawalSchema = new Schema({
  txHash:      { type: String, unique: true, index: true },
  userId:      { type: Schema.Types.ObjectId, ref: 'User' },
  uhid:        String,
  amountXRP:   Number,
  source:      String,
  destination: String,
  ledgerIndex: Number,
  txDate:      Date,
  raw:         Schema.Types.Mixed,
});

// Bind to the cWithdrawals collection explicitly so script & API share data
module.exports = mongoose.model('ChainWithdrawal', ChainWithdrawalSchema, 'cWithdrawals'); 