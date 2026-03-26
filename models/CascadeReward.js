const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Schema.Types;

const CascadeRewardSchema = new mongoose.Schema({
    userId: { // The user who received the bonus
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    triggeringUserId: { // The user whose activity triggered this bonus
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    triggeringEventId: { // The ID of the LedgerRow event (e.g., LP_DEPOSIT) that triggered this
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LedgerRow',
        required: true
    },
    amount: {
        type: Decimal128,
        required: true
    },
    rate: {
        type: Decimal128,
        required: true
    },
    narrative: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('CascadeReward', CascadeRewardSchema); 