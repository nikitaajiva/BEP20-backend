// A script to find users without a ledger and create one for them.
// This is useful for backfilling data after a schema change or data import.

const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
// const connectDB = require('../config/db'); // Removed for direct connection

const createMissingLedgers = async () => {
  const dbURI = 'mongodb://localhost:27017/xrpmigrate';
  console.log(`Connecting to the database at ${dbURI}...`);
  
  try {
    await mongoose.connect(dbURI);
    console.log('Database connected successfully.');

    console.log('Dropping existing Ledger collection...');
    try {
      await Ledger.collection.drop();
      console.log('Ledger collection dropped successfully.');
    } catch (error) {
      // If the collection doesn't exist, it's not an error in this context.
      if (error.code === 26 || error.message === 'ns not found') {
        console.log('Ledger collection did not exist, skipping drop.');
      } else {
        // For other errors, we should stop the script.
        throw error;
      }
    }

    console.log('Fetching all users to create fresh ledgers...');
    
    // Get all user IDs and UHIDs. lean() makes the query faster.
    const allUsers = await User.find({}, '_id uhid').lean();

    if (allUsers.length === 0) {
      console.log('No users found in the database. No ledgers will be created.');
      return;
    }

    console.log(`Found ${allUsers.length} users. Preparing to create a ledger for each one.`);

    // Prepare all the ledger documents to be inserted.
    const ledgersToCreate = allUsers.map(user => ({
      _id: user._id,
      userId: user._id,
      uhid: user.uhid
    }));

    // Use insertMany for efficient bulk insertion.
    console.log(`Bulk inserting ${ledgersToCreate.length} new ledger documents...`);
    const result = await Ledger.insertMany(ledgersToCreate);
    console.log(`Successfully created ${result.length} new ledgers.`);

  } catch (error) {
    console.error('An unexpected error occurred during the script execution:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
};

// Run the script
createMissingLedgers(); 