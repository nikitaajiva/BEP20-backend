const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');

const migrateLedgers = async () => {
  try {
    

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    // Find all ledgers
    const ledgers = await Ledger.find({});
    

    let updated = 0;
    let errors = 0;

    for (const ledger of ledgers) {
      try {
        // Initialize processedTransactions array if it doesn't exist
        if (!ledger.processedTransactions) {
          ledger.processedTransactions = [];
        }

        // Update pendingWithdrawal to include transactionId if it doesn't have one
        if (ledger.pendingWithdrawal && !ledger.pendingWithdrawal.transactionId) {
          ledger.pendingWithdrawal.transactionId = null;
        }

        await ledger.save();
        updated++;
      } catch (err) {
        console.error(`Error updating ledger ${ledger._id}:`, err);
        errors++;
      }
    }

    
    
    

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
  }
};

// Run migration if this script is run directly
if (require.main === module) {
  migrateLedgers().then(() => {
    
    process.exit(0);
  }).catch(err => {
    console.error('Migration script failed:', err);
    process.exit(1);
  });
}

module.exports = migrateLedgers; 
