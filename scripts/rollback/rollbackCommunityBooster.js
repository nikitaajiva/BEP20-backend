const mongoose = require('mongoose');
const Ledger = require('../../models/Ledger');
const CommunityBoosterReward = require('../../models/CommunityBoosterReward');
const LedgerRow = require('../../models/LedgerRow');
const { ensureDecimal128 } = require('../../utils/decimal128Utils');

/**
 * Script to rollback Community Booster changes
 * This will:
 * 1. Reset communityBoosterBonus wallet to 0 in all ledger documents
 * 2. Clear all entries from CommunityBoosterReward collection
 * 3. Reset communityBoosterProcessed flag in LedgerRow documents
 * 
 * Usage: 
 * - To do a dry run: node rollbackCommunityBooster.js --dry-run
 * - To actually perform rollback: node rollbackCommunityBooster.js
 */

async function rollbackCommunityBooster() {
    try {
        const isDryRun = process.argv.includes('--dry-run');
        console.log(`Running in ${isDryRun ? 'DRY RUN' : 'LIVE'} mode`);

        // Connect to MongoDB
        const dbURI = process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI);
        console.log('Connected to MongoDB');

        // 1. Get count of affected ledgers
        const ledgerCount = await Ledger.countDocuments({
            'wallets.communityBoosterBonus': { $exists: true, $ne: ensureDecimal128('0') }
        });

        // 2. Get count of community booster rewards
        const rewardCount = await CommunityBoosterReward.countDocuments({});

        // 3. Get count of processed ledger rows
        const ledgerRowCount = await LedgerRow.countDocuments({
            communityBoosterProcessed: true
        });

        console.log(`Found ${ledgerCount} ledgers with non-zero communityBoosterBonus`);
        console.log(`Found ${rewardCount} community booster reward records`);
        console.log(`Found ${ledgerRowCount} ledger rows marked as processed`);

        if (!isDryRun) {
            // 4. Reset communityBoosterBonus wallet in all ledgers
            const ledgerResult = await Ledger.updateMany(
                { 'wallets.communityBoosterBonus': { $exists: true } },
                { $set: { 'wallets.communityBoosterBonus': ensureDecimal128('0') } }
            );
            console.log(`Reset ${ledgerResult.modifiedCount} ledger documents`);

            // 5. Clear CommunityBoosterReward collection
            const deleteResult = await CommunityBoosterReward.deleteMany({});
            console.log(`Deleted ${deleteResult.deletedCount} community booster reward records`);

            // 6. Reset communityBoosterProcessed flag in LedgerRow documents
            const ledgerRowResult = await LedgerRow.updateMany(
                { communityBoosterProcessed: true },
                { $set: { communityBoosterProcessed: false } }
            );
            console.log(`Reset ${ledgerRowResult.modifiedCount} ledger row documents`);

            console.log('Rollback completed successfully');
        } else {
            console.log('Dry run completed - no changes made');
        }

    } catch (error) {
        console.error('Error during rollback:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the script
rollbackCommunityBooster(); 