const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One row per signed chain tx.
 *  • Shields against process-crash duplicates
 *  • Lets us probe idempotently with txHashHint
 */
const TxOutboxSchema = new Schema({
  hash:       { type: String, unique: true },
  status:     { type: String, enum: ['signed', 'submitted', 'validated', 'failed'], default: 'signed' },
  destination:{ type: String },
  drops:      { type: String },
  createdAt:  { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('TxOutbox', TxOutboxSchema);
