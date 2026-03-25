const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

const createIndexes = async () => {
    try {
        // Create compound unique index on dailyuserlps collection
        await mongoose.connection.db.collection('dailyuserlps').createIndex(
            { userId: 1, date: 1 },
            { unique: true }
        );
        console.log('Successfully created indexes');
    } catch (error) {
        console.error('Error creating indexes:', error);
        throw error;
    }
};

const run = async () => {
    try {
        await connectDB();
        await createIndexes();
        await mongoose.disconnect();
        console.log('Index creation completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Index creation failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

// Run the script
run(); 