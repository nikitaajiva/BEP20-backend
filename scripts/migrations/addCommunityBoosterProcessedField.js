const mongoose = require('mongoose');
const LedgerRow = require('../../models/LedgerRow');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const migrateCommunityBoosterProcessedField = async () => {
    try {
        await connectDB();
        console.log('Starting migration...');

        // Find all LedgerRow documents that don't have the communityBoosterProcessed field
        const result = await LedgerRow.updateMany(
            { communityBoosterProcessed: { $exists: false } },
            { $set: { communityBoosterProcessed: false } }
        );

        console.log(`Migration completed. Updated ${result.modifiedCount} documents.`);

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
};

// Run the migration
migrateCommunityBoosterProcessedField(); 