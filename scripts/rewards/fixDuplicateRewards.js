const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');
const connectDB = require("../../config/db");

// Import models
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const AirdropReward = require('../../models/AirdropReward');
const BoostReward = require('../../models/BoostReward');
const LpReward = require('../../models/LpReward');

// --- Helper Functions ---
const toFloat = (decimal) => {
    if (!decimal) return 0;
    if (decimal instanceof Decimal128) {
        return parseFloat(decimal.toString());
    }
    return parseFloat(decimal);
};
const fromFloat = (float) => Decimal128.fromString(float.toString());

// --- FIX DATE: 06 DEC 2025 ---
const START = new Date("2025-12-10T00:00:00.000Z");
const END   = new Date("2025-12-11T00:00:00.000Z");

const fixDuplicateRewards = async () => {
    await connectDB();
    

    const rewardTypes = [
        { model: LpReward, name: 'lp', eventType: 'DAILY_REWARDS_LP' },
        { model: AirdropReward, name: 'airdrop', eventType: 'DAILY_REWARDS_AIRDROP' },
        { model: BoostReward, name: 'boost', eventType: 'DAILY_REWARDS_BOOST' },
    ];

    try {
        for (const rewardType of rewardTypes) {
            const { model, name, eventType } = rewardType;

            

            const usersWithDuplicates = await model.aggregate([
                { $match: { createdAt: { $gte: START, $lt: END } } },
                { $group: { _id: '$userId', count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } }
            ]);

            if (usersWithDuplicates.length === 0) {
                
                continue;
            }

            

            for (const user of usersWithDuplicates) {
                const userId = user._id;
                const ledger = await Ledger.findOne({ userId });

                if (!ledger) {
                    console.error(`❌ Ledger not found for user ${userId}. Skipping.`);
                    continue;
                }

                

                // Fetch all reward documents
                const allRewards = await model
                    .find({ userId, createdAt: { $gte: START, $lt: END } })
                    .sort({ createdAt: 1 });

                const rewardsToKeep = allRewards[0];
                const rewardsToDelete = allRewards.slice(1);

                if (rewardsToDelete.length === 0) continue;

                const amountToReverse = rewardsToDelete.reduce(
                    (sum, r) => sum + toFloat(r.amount),
                    0
                );

                

                // --- LEDGER UPDATES ---
                ledger.wallets.communityRewards = fromFloat(
                    toFloat(ledger.wallets.communityRewards) - amountToReverse
                );

                ledger.totalRewardsCredited = fromFloat(
                    toFloat(ledger.totalRewardsCredited) - amountToReverse
                );

                ledger.limits[`${name}Limit`].used = fromFloat(
                    toFloat(ledger.limits[`${name}Limit`].used) - amountToReverse
                );

                // ⭐ IMPORTANT: 5X LIMIT REDUCTION
                ledger.limits.fiveXLimit.used = fromFloat(
                    toFloat(ledger.limits.fiveXLimit.used) - amountToReverse
                );

                await ledger.save();
                

                // Delete duplicate reward docs
                await model.deleteMany({ _id: { $in: rewardsToDelete.map(r => r._id) } });
                

                // Delete duplicate LedgerRow docs
                const ledgerRows = await LedgerRow.find({
                    userId,
                    eventType,
                    ts: { $gte: START, $lt: END }
                }).sort({ ts: 1 });

                const ledgerRowsToDelete = ledgerRows.slice(1);

                if (ledgerRowsToDelete.length > 0) {
                    await LedgerRow.deleteMany({
                        _id: { $in: ledgerRowsToDelete.map(r => r._id) }
                    });

                    console.log(
                        `🗑 Deleted ${ledgerRowsToDelete.length} duplicate LedgerRow entries.`
                    );
                }
            }
        }
    } catch (error) {
        console.error('\n❌ ERROR:', error);
    } finally {
        
        await mongoose.disconnect();
    }
};

fixDuplicateRewards();
