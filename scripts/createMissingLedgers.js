// A script to find users without a ledger and create one for them.
// This is useful for backfilling data after a schema change or data import.

const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
// const connectDB = require('../config/db'); // Removed for direct connection

const createMissingLedgers = async () => {
  const dbURI = 'mongodb://localhost:27017/xrpmigrate';
  
  
  try {
    await mongoose.connect(dbURI);
    

    
    try {
      await Ledger.collection.drop();
      
    } catch (error) {
      // If the collection doesn't exist, it's not an error in this context.
      if (error.code === 26 || error.message === 'ns not found') {
        
      } else {
        // For other errors, we should stop the script.
        throw error;
      }
    }

    
    
    // Get all user IDs and UHIDs. lean() makes the query faster.
    const allUsers = await User.find({}, '_id uhid').lean();

    if (allUsers.length === 0) {
      
      return;
    }

    

    // Prepare all the ledger documents to be inserted.
    const ledgersToCreate = allUsers.map(user => ({
      _id: user._id,
      userId: user._id,
      uhid: user.uhid
    }));

    // Use insertMany for efficient bulk insertion.
    
    const result = await Ledger.insertMany(ledgersToCreate);
    

  } catch (error) {
    console.error('An unexpected error occurred during the script execution:', error);
  } finally {
    await mongoose.disconnect();
    
  }
};

// Run the script
createMissingLedgers(); 
