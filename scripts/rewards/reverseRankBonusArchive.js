const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const Ledger = require('../../models/Ledger');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { add } = require('../../utils/decimal128Utils');

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

const reverseRankBonusArchive = async (dateStr) => {
    await connectDB();
    console.log(`\n--- Starting Reversal for Rank Bonus Archive on ${dateStr} ---`);

    if (!dateStr) {
        console.error('ERROR: Please provide a date string in YYYY-MM-DD format.');
        await mongoose.disconnect();
        process.exit(1);
    }

    const targetDate = new Date(dateStr);
    targetDate.setUTCHours(0, 0, 0, 0);

    console.log('\nReversing the daily rank bonus archive-and-reset using bulk operations...');
    const rankBonusArchiveLogs = await DailyRewardLog.find({
        rewardType: 'rankBonus',
        date: targetDate
    }).lean();

    console.log(`Found ${rankBonusArchiveLogs.length} 'rankBonus' archive entries to restore.`);
    if (rankBonusArchiveLogs.length > 0) {
        const ledgerRestoreOps = rankBonusArchiveLogs.map(log => ({
            updateOne: {
                filter: { userId: log.userId },
                // This restores the value that was reset to zero by adding it back.
                update: { $inc: { 'wallets.dailyRankBonus': log.amount } }
            }
        }));

        await Ledger.bulkWrite(ledgerRestoreOps);
        console.log(`Restored 'dailyRankBonus' for ${rankBonusArchiveLogs.length} users from the archive via bulk update.`);

        await DailyRewardLog.deleteMany({ _id: { $in: rankBonusArchiveLogs.map(l => l._id) } });
        console.log(`Deleted ${rankBonusArchiveLogs.length} 'rankBonus' archive log entries.`);
    }

    console.log('\n--- Rank Bonus Archive Reversal Script Finished ---');
    await mongoose.disconnect();
};

const dateArg = process.argv[2];
reverseRankBonusArchive(dateArg); 