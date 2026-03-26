const mongoose = require("mongoose");

const RewardSkipLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId },
  username: String,
  uhid: String,
  rewardDate: { type: Date, required: true },
  reason: { type: String, required: true },
  lpBalance: Number,
  airdropBalance: Number,
  boostBalance: Number,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("RewardSkipLog", RewardSkipLogSchema);
