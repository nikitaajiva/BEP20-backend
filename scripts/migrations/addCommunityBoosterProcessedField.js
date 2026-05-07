const mongoose = require('mongoose');
const LedgerRow = require('../../models/LedgerRow');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const migrateCommunityBoosterProcessedField = async () => {
    try {
        await connectDB();
        

        // Find all LedgerRow documents that don't have the communityBoosterProcessed field
        const result = await LedgerRow.updateMany(
            { communityBoosterProcessed: { $exists: false } },
            { $set: { communityBoosterProcessed: false } }
        );

        

    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await mongoose.disconnect();
        
    }
};

// Run the migration
migrateCommunityBoosterProcessedField(); 
