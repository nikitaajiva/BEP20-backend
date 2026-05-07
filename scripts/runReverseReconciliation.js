const mongoose = require('mongoose');
const reverseReconcileWithdrawals = require('../jobs/reverseReconcileWithdrawals');

async function main() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database');
    

    // Run the reversal
    await reverseReconcileWithdrawals();
    
    
  } catch (error) {
    console.error('Reversal failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
