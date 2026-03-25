const mongoose = require("mongoose");
const { Schema, Types } = mongoose;

const XrpTxLogSchema = new Schema({
  withdrawal_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  idempotency_key: String,
  destination: String,
  amount_xrp: Number,
  response: Object, // entire API response
  error: String,
  createdAt: { type: Date, default: Date.now },
});


module.exports = mongoose.models.XrpTxLog || mongoose.model("XrpTxLog", XrpTxLogSchema);
