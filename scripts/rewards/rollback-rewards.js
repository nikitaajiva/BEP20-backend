const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const AirdropReward = require('../../models/AirdropReward');
const BoostReward = require('../../models/BoostReward');
const LpReward = require('../../models/LpReward');
const LedgerRow = require('../../models/LedgerRow');

const connectDB = async (dbName) => {
    try {
        const uri = (process.env.MONGO_URI || 'mongodb://localhost:27017/').replace(/\/[^/]*$/, `/${dbName}`);
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log(`MongoDB Connected to ${dbName}...`);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const rollbackRewards = async () => {
    const dbName = process.argv[2];
    const backupCollectionName = process.argv[3];

    if (!dbName || !backupCollectionName) {
        console.error('Usage: node rollback-rewards.js <db_name> <backup_collection_name>');
        console.error('Example: node rollback-rewards.js xrpmigrate ledgers_backup_2024-06-15T23-30-00Z');
        process.exit(1);
    }

    await connectDB(dbName);
    const db = mongoose.connection.db;

    try {
        console.log(`\n--- Starting Rollback Process for database '${dbName}' ---`);

        // 1. Restore ledgers from backup
        console.log(`\nStep 1: Restoring 'ledgers' from '${backupCollectionName}'...`);
        const backupExists = await db.listCollections({ name: backupCollectionName }).hasNext();
        if (!backupExists) {
            throw new Error(`Backup collection '${backupCollectionName}' not found!`);
        }
        await db.collection('ledgers').drop();
        console.log("'ledgers' collection dropped.");
        await db.collection(backupCollectionName).rename('ledgers');
        console.log(`'${backupCollectionName}' successfully renamed to 'ledgers'. Rollback of ledgers complete.`);

        // 2. Delete reward entries
        console.log("\nStep 2: Deleting reward entries...");
        const airdropResult = await AirdropReward.deleteMany({});
        console.log(`- Deleted ${airdropResult.deletedCount} documents from 'airdroprewards'.`);
        const boostResult = await BoostReward.deleteMany({});
        console.log(`- Deleted ${boostResult.deletedCount} documents from 'boostrewards'.`);
        const lpResult = await LpReward.deleteMany({});
        console.log(`- Deleted ${lpResult.deletedCount} documents from 'lprewards'.`);

        // 3. Delete LedgerRow entries
        console.log("\nStep 3: Deleting reward rows from 'ledgerrows'...");
        const eventTypesToDelete = ['DAILY_REWARDS_LP', 'DAILY_REWARDS_AIRDROP', 'DAILY_REWARDS_BOOST'];
        const ledgerRowResult = await LedgerRow.deleteMany({ eventType: { $in: eventTypesToDelete } });
        console.log(`- Deleted ${ledgerRowResult.deletedCount} reward-related documents from 'ledgerrows'.`);
        
        console.log('\n--- Rollback Complete! ---');
        console.log('Database has been restored to the state before the rewards distribution.');

    } catch (error) {
        console.error('\nAn error occurred during the rollback process:', error);
    } finally {
        await mongoose.disconnect();
    }
};

rollbackRewards(); 