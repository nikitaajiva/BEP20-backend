const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const Ledger = require('../../models/Ledger');

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

const backupLedgers = async () => {
    const dbName = process.argv[2];
    if (!dbName) {
        console.error('Please provide a database name to backup. e.g., node backup-ledgers.js xrpmigrate');
        process.exit(1);
    }

    await connectDB(dbName);

    const backupCollectionName = `ledgersBackup`;

    console.log(`Backing up 'ledgers' collection to '${backupCollectionName}'...`);

    try {
        await Ledger.aggregate([
            { $match: {} },
            { $out: backupCollectionName }
        ]).exec();
        
        console.log('\nBackup complete!');
        console.log(`Successfully created backup collection: ${backupCollectionName}`);
        console.log('You can now safely run the distributeRewards script.');

    } catch (error) {
        console.error('An error occurred during the backup process:', error);
    } finally {
        await mongoose.disconnect();
    }
};

backupLedgers(); 