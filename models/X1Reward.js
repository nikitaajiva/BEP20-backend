const mongoose = require('mongoose');
const { Schema } = mongoose;

const x1RewardSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    depositorId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Schema.Types.Decimal128,
        required: true
    },
    tier: {
        type: String,
        enum: ['X','X1', 'X2', 'X3', 'X4', 'X5'],
        required: true
    },
    rate: {
        type: Number,
        required: true
    },
    level: {
        type: Number,
        required: true
    },
    depositAmount: {
        type: Schema.Types.Decimal128,
        required: true
    },
    triggeringEventId: {
        type: String,
        required: true
    },
    ts: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('X1Reward', x1RewardSchema); 