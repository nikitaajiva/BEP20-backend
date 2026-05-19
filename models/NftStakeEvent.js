const mongoose = require("mongoose");

const NftStakeEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userNft: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserNft",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["STAKE", "UNSTAKE"],
      required: true,
      index: true,
    },
    previousStatus: {
      type: String,
      default: null,
    },
    newStatus: {
      type: String,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

NftStakeEventSchema.index({ user: 1, createdAt: -1 });
NftStakeEventSchema.index({ userNft: 1, createdAt: -1 });

module.exports =
  mongoose.models.NftStakeEvent ||
  mongoose.model("NftStakeEvent", NftStakeEventSchema);
