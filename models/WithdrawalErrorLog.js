const mongoose = require('mongoose');

const { Schema } = mongoose;

// Schema to capture detailed information about failed withdrawal attempts.
const WithdrawalErrorLogSchema = new Schema({
  userId:       { type: Schema.Types.ObjectId, ref: 'User', index: true },
  ledgerRowId:  { type: Schema.Types.ObjectId, ref: 'LedgerRow', index: true },

  uniqueTransactionId: String,  // memo / unique id embedded in XRPL tx
  walletFrom:           String, // LP | COMMUNITY_REWARDS | ZERO_RISK
  amount:               Schema.Types.Decimal128, // Amount attempted (in XRP)
  destinationAddress:   String, // User's XRP address
  memo:                 String, // Hex/plain memo stored in XRPL payment (same as uniqueTransactionId)

  // XRPL error/result fields
  errorCode:    String, // e.g. tecNO_DST, tefFAILURE, etc.
  errorMessage: String, // Human-readable message
  xrpResponse:  Schema.Types.Mixed, // Raw response object (if available)

  // Node / application error details
  stackTrace:   String,

  createdAt:    { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('WithdrawalErrorLog', WithdrawalErrorLogSchema); 