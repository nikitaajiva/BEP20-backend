const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Schema.Types;

const RankRewardSchema = new mongoose.Schema({
    userId: { // The user who received the bonus
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    triggeringUserId: { // The user whose activity triggered this bonus (null for one-time rank-up)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
        default: null
    },
    triggeringEventId: { // The ID of the LedgerRow event (e.g., LP_DEPOSIT) that triggered this
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LedgerRow'
    },
    type: { // The type of bonus
        type: String,
        enum: ['one-time', 'differential'],
        required: true
    },
    amount: {
        type: Decimal128,
        required: true
    },
    rate: { // The differential rate for differential bonuses
        type: Decimal128,
        default: null
    },
    narrative: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('RankReward', RankRewardSchema); 
