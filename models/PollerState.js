const mongoose = require('mongoose');

const PollerStateSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true,
    },
    lastProcessedLedger: {
        type: Number,
        required: true,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

PollerStateSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('PollerState', PollerStateSchema); 
