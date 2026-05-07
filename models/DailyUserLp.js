const mongoose = require('mongoose');
const { Schema } = mongoose;

const dailyUserLpSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    lp: {
        type: Number,
        default: 0
    }
});

// Compound index for faster lookups
dailyUserLpSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyUserLp', dailyUserLpSchema); 
