const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { handlePositioningBonus } = require('../../jobs/eventHandlers/positioningBonusHandler');

const connectDB = require("../../config/db");
const archiveAndResetDailyRankBonus = async () => {
    console.log('Archiving and resetting daily rank bonuses...');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const ledgersToArchive = await Ledger.find({ 'wallets.dailyRankBonus': { $gt: mongoose.Types.Decimal128.fromString('0') } });
    if (ledgersToArchive.length === 0) {
        console.log('No daily rank bonuses to archive.');
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

    console.log(`Archived and reset daily rank bonuses for ${ledgersToArchive.length} users.`);
};

const distributePositioningBonuses = async () => {
    await connectDB();
    console.log('Starting Positioning Bonus distribution script...');

    await archiveAndResetDailyRankBonus();

    // Find LP deposits that have not been processed for positioning bonuses yet.
    const lpDepositEvents = await LedgerRow.find({
        eventType: 'DAILY_REWARDS_LP',
        positioningBonusProcessed: { $ne: true }
    }).lean();

    console.log(`Found ${lpDepositEvents.length} new LP deposits to process for positioning bonuses.`);

    for (const event of lpDepositEvents) {
        try {
            console.log(`\n--- Processing positioning bonus for User: ${event.userId}, Event: ${event._id} ---`);

            const payload = {
                depositorUserId: event.userId.toString(),
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

            await handlePositioningBonus(payload);

            // Mark this event as processed
            await LedgerRow.updateOne({ _id: event._id }, { $set: { positioningBonusProcessed: true } });

            console.log(`--- Successfully processed positioning bonus for User: ${event.userId} ---`);

        } catch (error) {
            console.error(`Failed to process positioning bonus for user ${event.userId} from event ${event._id}:`, error);
        }
    }

    console.log('\nPositioning Bonus distribution script finished.');
    await mongoose.disconnect();
};

distributePositioningBonuses(); 