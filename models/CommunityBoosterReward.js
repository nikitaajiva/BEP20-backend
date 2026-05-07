const mongoose = require('mongoose');

const communityBoosterRewardSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    triggeringUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    triggeringEventId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LedgerRow',
        required: true
    },
    amount: {
        type: mongoose.Schema.Types.Decimal128,
        required: true,
        get: v => v?.toString()
    },
    rate: {
        type: mongoose.Schema.Types.Decimal128,
        required: true,
        get: v => v?.toString()
    },
    level: {
        type: Number,
        required: true,
        enum: [1, 2, 3]
    },
    tier: {
        type: Number,
        required: true,
        enum: [10000, 20000, 30000]
    },
    isDoubleReward: {
        type: Boolean,
        default: false
    },
    narrative: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    toJSON: { getters: true },
    toObject: { getters: true }
});

communityBoosterRewardSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('CommunityBoosterReward', communityBoosterRewardSchema); 
