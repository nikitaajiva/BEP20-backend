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
        
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const distributeCommunityPositioningBonus = async () => {
    await connectDB();
    

    // Find LP deposits that have not been processed for this bonus yet.
    const lpDepositEvents = await LedgerRow.find({
        eventType: 'DAILY_REWARDS_LP',
        communityPositioningBonusProcessed: { $ne: true }
    }).lean();

    

    for (const event of lpDepositEvents) {
        try {
            

            const payload = {
                depositorUserId: event.userId,
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

            await handleLevelBooster(payload);

            // Mark this event as processed
            await LedgerRow.updateOne({ _id: event._id }, { $set: { communityPositioningBonusProcessed: true } });

            

        } catch (error) {
            console.error(`Failed to process Community Positioning Bonus for user ${event.userId} from event ${event._id}:`, error);
        }
    }

    
    await mongoose.disconnect();
};

distributeCommunityPositioningBonus();
