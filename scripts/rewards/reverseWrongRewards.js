const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');

// Import models
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const AirdropReward = require('../../models/AirdropReward');
const BoostReward = require('../../models/BoostReward');
const LpReward = require('../../models/LpReward');
const User = require('../../models/User');

// --- Helper Functions ---
const toFloat = (decimal) => {
    if (decimal instanceof Decimal128) {
        return parseFloat(decimal.toString());
    }
    return parseFloat(decimal);
};
const fromFloat = (float) => Decimal128.fromString(float.toString());

// --- DB Connection ---
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

const reverseWrongRewards = async () => {
    await connectDB();
    console.log('Starting rewards reversal script...');

    // Use the start of today in UTC as the cutoff to find records from the faulty run.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    try {
        // Find all reward documents created since the start of today.
        // This assumes that the script was run today.
        const lpRewards = await LpReward.find({ createdAt: { $gte: today } });
        const airdropRewards = await AirdropReward.find({ createdAt: { $gte: today } });
        const boostRewards = await BoostReward.find({ createdAt: { $gte: today } });

        const allRewards = [...lpRewards, ...airdropRewards, ...boostRewards];
        if (allRewards.length === 0) {
            console.log('No reward records found for today. Nothing to reverse.');
            await mongoose.disconnect();
            return;
        }

        console.log(`Found ${lpRewards.length} LP rewards, ${airdropRewards.length} Airdrop rewards, and ${boostRewards.length} Boost rewards to reverse.`);

        // Group rewards by user to process each user's ledger once.
        const userRewards = {};
        const processReward = (reward, type) => {
            const userId = reward.userId.toString();
            if (!userRewards[userId]) {
                userRewards[userId] = { lp: 0, airdrop: 0, boost: 0, total: 0 };
            }
            const amount = toFloat(reward.amount);
            userRewards[userId][type] += amount;
            userRewards[userId].total += amount;
        };

        lpRewards.forEach(r => processReward(r, 'lp'));
        airdropRewards.forEach(r => processReward(r, 'airdrop'));
        boostRewards.forEach(r => processReward(r, 'boost'));

        console.log(`Processing reversals for ${Object.keys(userRewards).length} unique users.`);

        // Reverse ledger values for each affected user
        for (const userId in userRewards) {
            const rewards = userRewards[userId];
            const ledger = await Ledger.findOne({ userId: new mongoose.Types.ObjectId(userId) });

            if (!ledger) {
                console.error(`ERROR: Ledger for user ${userId} not found, skipping reversal for this user.`);
                continue;
            }

            console.log(`\n--- Reversing for User: ${ledger.uhid} (ID: ${userId}) ---`);
            console.log(`Total reward to reverse: ${rewards.total}`);

            // Reverse wallet and limit updates
            ledger.wallets.communityRewards = fromFloat(toFloat(ledger.wallets.communityRewards) - rewards.total);
            ledger.totalRewardsCredited = fromFloat(toFloat(ledger.totalRewardsCredited) - rewards.total);
            ledger.limits.lpLimit.used = fromFloat(toFloat(ledger.limits.lpLimit.used) - rewards.lp);
            ledger.limits.airdropLimit.used = fromFloat(toFloat(ledger.limits.airdropLimit.used) - rewards.airdrop);
            ledger.limits.boostLimit.used = fromFloat(toFloat(ledger.limits.boostLimit.used) - rewards.boost);
            ledger.limits.fiveXLimit.used = fromFloat(toFloat(ledger.limits.fiveXLimit.used) - rewards.total);

            // Restore zeroRisk wallet balance
            const restoredZeroRisk = toFloat(ledger.wallets.zeroRisk) + rewards.total;
            ledger.wallets.zeroRisk = fromFloat(restoredZeroRisk);
            console.warn(`  - User ${ledger.uhid}: zeroRisk wallet restored to ${restoredZeroRisk}. Please manually verify this value if the wallet was depleted during the faulty run.`);

            await ledger.save();
            console.log(`  - Successfully reverted ledger for user ${ledger.uhid}.`);
        }

        // Clean up the created documents
        console.log('\n--- Cleaning up created documents ---');
        
        const lpRewardIds = lpRewards.map(r => r._id);
        const airdropRewardIds = airdropRewards.map(r => r._id);
        const boostRewardIds = boostRewards.map(r => r._id);
        
        if(lpRewardIds.length > 0) await LpReward.deleteMany({ _id: { $in: lpRewardIds } });
        if(airdropRewardIds.length > 0) await AirdropReward.deleteMany({ _id: { $in: airdropRewardIds } });
        if(boostRewardIds.length > 0) await BoostReward.deleteMany({ _id: { $in: boostRewardIds } });
        console.log('Deleted reward documents.');
        
        const userIds = Object.keys(userRewards).map(id => new mongoose.Types.ObjectId(id));
        await LedgerRow.deleteMany({
            userId: { $in: userIds },
            eventType: { $in: ['DAILY_REWARDS_LP', 'DAILY_REWARDS_AIRDROP', 'DAILY_REWARDS_BOOST'] },
            createdAt: { $gte: today }
        });
        console.log('Deleted daily reward ledger rows.');

    } catch (error) {
        console.error('\nAn error occurred during the reversal process:', error);
    } finally {
        console.log('\nRewards reversal script finished.');
        await mongoose.disconnect();
    }
};

reverseWrongRewards(); 