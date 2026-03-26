const mongoose = require('mongoose');

const { Schema } = mongoose;

// Schema for on-chain deposits captured by trackChainTx.js
const ChainDepositSchema = new Schema({
  txHash:      { type: String, unique: true, index: true },
  userId:      { type: Schema.Types.ObjectId, ref: 'User' },
  uhid:        String,
  amount:      Number,
  source:      String,
  destination: String,
  ledgerIndex: Number,
  txDate:      Date,
  raw:         Schema.Types.Mixed,
  network:     { type: String, default: "BEP20" },
  tokenContract: String,
});

// Bind to the cDeposits collection explicitly so script & API share data
module.exports = mongoose.model('ChainDeposit', ChainDepositSchema, 'cDeposits'); 
