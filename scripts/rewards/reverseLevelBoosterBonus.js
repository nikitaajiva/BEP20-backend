const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const Ledger = require('../../models/Ledger');
const DailyRewardLog = require('../../models/DailyRewardLog');
const LedgerRow = require('../../models/LedgerRow');
const User = require('../../models/User');
const { subtract } = require('../../utils/decimal128Utils');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate_test";
        await mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const getExecutionDateRange = (dateStr) => {
    const targetDate = new Date(dateStr);
    targetDate.setUTCHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setUTCDate(targetDate.getUTCDate() + 1);
    return { start: targetDate, end: nextDate };
};

const reverseLevelBoosterBonuses = async (dateStr) => {
    await connectDB();
    console.log(`\n--- Starting Reversal for Level Booster Bonuses created on ${dateStr} for ALL USERS ---`);

    if (!dateStr) {
        console.error('ERROR: Please provide a date string in YYYY-MM-DD format.');
        await mongoose.disconnect();
        process.exit(1);
    }
    const { start, end } = getExecutionDateRange(dateStr);

    console.log('\nFinding Level Booster Bonuses to reverse...');
    
    const query = {
        rewardType: 'levelBoosterBonus',
        date: { $gte: start, $lt: end }
    };

    const levelBoosterBonusLogs = await DailyRewardLog.find(query).lean();

    console.log(`Found ${levelBoosterBonusLogs.length} 'levelBoosterBonus' entries to reverse.`);
    if (levelBoosterBonusLogs.length === 0) {
        await mongoose.disconnect();
        return;
    }

    const eventIdsToReset = new Set();

    for (const log of levelBoosterBonusLogs) {
        console.log(`\n------------------------------------------------------------`);
        console.log(`Reversing log: ${JSON.stringify(log, null, 2)}`);

        const userLedger = await Ledger.findOne({ userId: log.userId });
        if (!userLedger) {
            console.log(`WARNING: Could not find ledger for userId: ${log.userId}. Skipping reversal for this log.`);
            continue;
        }

        console.log(`--- Ledger BEFORE for ${log.userId}: \n${JSON.stringify(userLedger.toObject(), null, 2)}`);

        const amount = log.amount;
        userLedger.wallets.dailyLevelBoosterBonus = subtract(userLedger.wallets.dailyLevelBoosterBonus, amount);
        userLedger.wallets.levelBoosterBonus = subtract(userLedger.wallets.levelBoosterBonus, amount);
        userLedger.wallets.communityRewards = subtract(userLedger.wallets.communityRewards, amount);
        
        await userLedger.save();
        
        console.log(`--- Ledger AFTER for ${log.userId}: \n${JSON.stringify(userLedger.toObject(), null, 2)}`);
        
        if (log.details.triggeringEventId) {
            eventIdsToReset.add(log.details.triggeringEventId.toString());
        }
    }

    if (eventIdsToReset.size > 0) {
        const objectIds = [...eventIdsToReset].map(id => new mongoose.Types.ObjectId(id));
        await LedgerRow.updateMany({ _id: { $in: objectIds } }, { $set: { levelBoosterBonusProcessed: false } });
        console.log(`\nReset 'levelBoosterBonusProcessed' flag for ${objectIds.length} LedgerRow events.`);
    }

    await DailyRewardLog.deleteMany({ _id: { $in: levelBoosterBonusLogs.map(l => l._id) } });
    console.log(`Deleted ${levelBoosterBonusLogs.length} 'levelBoosterBonus' log entries.`);

    console.log('\n--- Level Booster Bonus Reversal Script Finished ---');
    await mongoose.disconnect();
};

const dateArg = process.argv[2];
reverseLevelBoosterBonuses(dateArg); 