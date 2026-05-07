const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const DailyRewardLog = require('../../models/DailyRewardLog');
const User = require('../../models/User');
const { handleLevelBoosterBonus } = require('../../jobs/eventHandlers/levelBoosterBonusHandler');

const connectDB = require("../../config/db");

const distributeLevelBoosterBonuses = async () => {
    // Step 1: Connect to the database.
    await connectDB();
    

    // Step 2: Build the query to find all unprocessed 'DAILY_REWARDS_LP' events.
    const query = {
        eventType: 'DAILY_REWARDS_LP',
        levelBoosterBonusProcessed: { $ne: true }
    };
    
    // Execute the query.
    const lpDepositEvents = await LedgerRow.find(query).lean();

    

    // Step 3: Loop through each event and process it.
    for (const event of lpDepositEvents) {
        try {
            

            // Step 3a: Create the payload for the event handler.
            const payload = {
                depositorUserId: event.userId.toString(),
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

            // Step 3b: Call the handler with the payload to perform the bonus calculation and award.
            await handleLevelBoosterBonus(payload);

            // Step 3c: Mark this event as processed to prevent double-awarding.
            await LedgerRow.updateOne({ _id: event._id }, { $set: { levelBoosterBonusProcessed: true } });

            

        } catch (error) {
            console.error(`Failed to process level booster bonus for user ${event.userId} from event ${event._id}:`, error);
        }
    }

    // Step 4: Disconnect from the database.
    
    await mongoose.disconnect();
};

distributeLevelBoosterBonuses(); 
