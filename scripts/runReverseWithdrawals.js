const mongoose = require('mongoose');
const reverseWithdrawals = require('../jobs/reverseWithdrawals');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database');
    console.log('Connected to MongoDB');

    await reverseWithdrawals();

    console.log('Reverse process completed');
  } catch (err) {
    console.error('Reverse process failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main(); 