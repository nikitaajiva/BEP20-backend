const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');

const migrateLedgers = async () => {
  try {
    console.log('Starting migration to add transaction tracking fields...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    // Find all ledgers
    const ledgers = await Ledger.find({});
    console.log(`Found ${ledgers.length} ledgers to update`);

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

    console.log(`Migration completed:`);
    console.log(`- Successfully updated: ${updated}`);
    console.log(`- Errors: ${errors}`);

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
  }
};

// Run migration if this script is run directly
if (require.main === module) {
  migrateLedgers().then(() => {
    console.log('Migration script completed');
    process.exit(0);
  }).catch(err => {
    console.error('Migration script failed:', err);
    process.exit(1);
  });
}

module.exports = migrateLedgers; 