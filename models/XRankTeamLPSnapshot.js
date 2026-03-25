const mongoose = require("mongoose");

const XRankTeamLPSnapshotSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  uhid: { type: String, required: true },
  xRank: { type: String, required: true },

  teamLP: { type: mongoose.Schema.Types.Decimal128, required: true },

  snapshotDate: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = mongoose.model(
  "XRankTeamLPSnapshot",
  XRankTeamLPSnapshotSchema
);
