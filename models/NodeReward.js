const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Schema.Types;

const NodeRewardSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    nodeTier: {
        type: String,
        enum: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"],
        required: true
    },
    amount: {
        type: Decimal128,
        required: true
    },
    rewardType: {
        type: String,
        enum: ["mining_cut", "fee_airdrop"],
        required: true
    },
    narrative: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('NodeReward', NodeRewardSchema);
