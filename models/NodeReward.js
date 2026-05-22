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
    },
    // Source withdrawal amount that triggered this airdrop
    withdrawalAmount: {
        type: Decimal128,
        default: null
    },
    // The percentage share this tier pool receives (e.g. 0.20 for P1 = 20%)
    tierSharePct: {
        type: Number,
        default: null
    },
    // Traceability back to the withdrawal event
    triggeringWithdrawalId: {
        type: String,
        default: null,
        index: true
    }
}, { timestamps: true });

module.exports = mongoose.model('NodeReward', NodeRewardSchema);

