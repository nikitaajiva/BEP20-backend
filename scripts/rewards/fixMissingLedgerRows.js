const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');

// Import models
const LedgerRow = require('../../models/LedgerRow');
const LpReward = require('../../models/LpReward');
const AirdropReward = require('../../models/AirdropReward');
const BoostReward = require('../../models/BoostReward');
const User = require('../../models/User'); // Assuming you may need user details for logging

const connectDB = async () => {
    try {
        await mongoose.connect("mongodb://localhost:27017/xrpmigrate", {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const fixMissingLedgerRows = async () => {
    await connectDB();
    console.log('Starting script to fix missing LedgerRow entries...');

    // Define the time range for the failed script run.
    // This should be adjusted to be a safe but narrow window around when the script was run.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // Start of today (UTC)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1); // Start of tomorrow (UTC)

    console.log(`Searching for rewards created between ${today.toISOString()} and ${tomorrow.toISOString()}`);

    const rewardModels = [
        { model: LpReward, eventType: 'DAILY_REWARDS_LP', narrative: 'Daily LP Reward' },
        { model: AirdropReward, eventType: 'DAILY_REWARDS_AIRDROP', narrative: 'Daily Airdrop Reward' },
        { model: BoostReward, eventType: 'DAILY_REWARDS_BOOST', narrative: 'Daily Boost Reward' },
    ];

    let fixedEntries = 0;

    for (const { model, eventType, narrative } of rewardModels) {
        const rewards = await model.find({ createdAt: { $gte: today, $lt: tomorrow } });
        console.log(`Found ${rewards.length} rewards of type ${eventType} to check.`);

        for (const reward of rewards) {
            try {
                // Check if a corresponding LedgerRow already exists
                const existingRow = await LedgerRow.findOne({
                    userId: reward.userId,
                    eventType: eventType,
                    amount: reward.amount,
                    createdAt: { $gte: today, $lt: tomorrow }
                });

                if (existingRow) {
                    // console.log(`LedgerRow already exists for user ${reward.userId} for ${eventType}. Skipping.`);
                    continue;
                }

                // If no corresponding row, create one.
                console.log(`Creating missing LedgerRow for user ${reward.userId} for ${eventType} of amount ${reward.amount.toString()}`);
                
                const user = await User.findById(reward.userId).select('uhid').lean();
                
                await LedgerRow.create({
                    userId: reward.userId,
                    eventType: eventType,
                    walletTo: 'COMMUNITY_REWARDS',
                    amount: reward.amount,
                    narrative: `${narrative} @ ${parseFloat(reward.rate.toString()) * 100}%`,
                    refId: user ? user.uhid : reward.userId.toString() // Add a reference if possible
                });
                
                fixedEntries++;
                console.log(`Successfully created missing LedgerRow for user ${reward.userId}`);

            } catch (error) {
                console.error(`Failed to process fix for user ${reward.userId} and reward type ${eventType}.`, error);
            }
        }
    }

    console.log(`\nFix script finished. Created ${fixedEntries} missing LedgerRow entries.`);
    await mongoose.disconnect();
};

fixMissingLedgerRows(); 