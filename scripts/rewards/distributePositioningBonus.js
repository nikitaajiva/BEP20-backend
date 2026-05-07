const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { handlePositioningBonus } = require('../../jobs/eventHandlers/positioningBonusHandler');

const connectDB = require("../../config/db");
const archiveAndResetDailyRankBonus = async () => {
    
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const ledgersToArchive = await Ledger.find({ 'wallets.dailyRankBonus': { $gt: mongoose.Types.Decimal128.fromString('0') } });
    if (ledgersToArchive.length === 0) {
        
        return;
    }
    const archiveOps = ledgersToArchive.map(ledger => ({
        insertOne: {
            document: {
                userId: ledger.userId,
                date: today,
                rewardType: 'rankBonus',
                amount: ledger.wallets.dailyRankBonus
            }
        }
    }));

    const resetOps = ledgersToArchive.map(ledger => ({
        updateOne: {
            filter: { _id: ledger._id },
            update: { $set: { 'wallets.dailyRankBonus': mongoose.Types.Decimal128.fromString('0') } }
        }
    }));
    
    await DailyRewardLog.bulkWrite(archiveOps);
    await Ledger.bulkWrite(resetOps);

    
};

const distributePositioningBonuses = async () => {
    await connectDB();
    

    await archiveAndResetDailyRankBonus();

    // Find LP deposits that have not been processed for positioning bonuses yet.
    const lpDepositEvents = await LedgerRow.find({
        eventType: 'DAILY_REWARDS_LP',
        positioningBonusProcessed: { $ne: true }
    }).lean();

    

    for (const event of lpDepositEvents) {
        try {
            

            const payload = {
                depositorUserId: event.userId.toString(),
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

            await handlePositioningBonus(payload);

            // Mark this event as processed
            await LedgerRow.updateOne({ _id: event._id }, { $set: { positioningBonusProcessed: true } });

            

        } catch (error) {
            console.error(`Failed to process positioning bonus for user ${event.userId} from event ${event._id}:`, error);
        }
    }

    
    await mongoose.disconnect();
};

distributePositioningBonuses(); 
