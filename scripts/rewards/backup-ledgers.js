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

    

    try {
        await Ledger.aggregate([
            { $match: {} },
            { $out: backupCollectionName }
        ]).exec();
        
        
        
        

    } catch (error) {
        console.error('An error occurred during the backup process:', error);
    } finally {
        await mongoose.disconnect();
    }
};

backupLedgers(); 
