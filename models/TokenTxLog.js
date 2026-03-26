const mongoose = require("mongoose");
const { Schema } = mongoose;

const TokenTxLogSchema = new Schema({
  withdrawal_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  idempotency_key: String,
  destination: String,
  amount: Number,
  response: Object,
  error: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports =
  mongoose.models.TokenTxLog || mongoose.model("TokenTxLog", TokenTxLogSchema);
