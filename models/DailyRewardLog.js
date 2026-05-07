const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const RewardDetailSchema = new mongoose.Schema({
    level: { type: Number, required: true },
    percentage: { type: Number, required: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    rewardedOn: { type: mongoose.Schema.Types.Decimal128, required: true }
}, { _id: false });

const DailyRewardLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true, index: true },
    rewardType: { 
        type: String, 
        required: true, 
        enum: ['rankBonus', 'dailyRoi', 'positioningBonus', 'levelBoosterBonus','cascade'] 
    },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    details: {
        triggeringUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        triggeringEventId: { type: mongoose.Schema.Types.ObjectId },
        description: { type: String },
        level: { type: Number },
        rate: { type: mongoose.Schema.Types.Decimal128 }
    }
}, { timestamps: true, collection: 'dailyrewardlogs' });

DailyRewardLogSchema.index({ userId: 1, date: 1, rewardType: 1 });

DailyRewardLogSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('DailyRewardLog', DailyRewardLogSchema); 
