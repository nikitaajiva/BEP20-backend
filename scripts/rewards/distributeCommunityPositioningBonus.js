const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Import models
const LedgerRow = require('../../models/LedgerRow');
const { handleLevelBooster } = require('../../jobs/eventHandlers/levelBoosterHandler');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const distributeCommunityPositioningBonus = async () => {
    await connectDB();
    console.log('Starting COMMUNITY POSITIONING BONUS distribution script...');

    // Find LP deposits that have not been processed for this bonus yet.
    const lpDepositEvents = await LedgerRow.find({
        eventType: 'DAILY_REWARDS_LP',
        communityPositioningBonusProcessed: { $ne: true }
    }).lean();

    console.log(`Found ${lpDepositEvents.length} new LP deposits to process for Community Positioning Bonus.`);

    for (const event of lpDepositEvents) {
        try {
            console.log(`\n--- Processing Community Positioning Bonus for User: ${event.userId}, Event: ${event._id} ---`);

            const payload = {
                depositorUserId: event.userId,
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

            await handleLevelBooster(payload);

            // Mark this event as processed
            await LedgerRow.updateOne({ _id: event._id }, { $set: { communityPositioningBonusProcessed: true } });

            console.log(`--- Successfully processed Community Positioning Bonus for User: ${event.userId} ---`);

        } catch (error) {
            console.error(`Failed to process Community Positioning Bonus for user ${event.userId} from event ${event._id}:`, error);
        }
    }

    console.log('\nCOMMUNITY POSITIONING BONUS distribution script finished.');
    await mongoose.disconnect();
};

distributeCommunityPositioningBonus();
