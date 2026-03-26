require('dotenv').config({ path: '../.env' }); // Adjust path if running from migrations folder
const mongoose = require('mongoose');

// Import all models
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const Outbox = require('../models/Outbox');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined. Make sure .env file is present and configured.');
  process.exit(1);
}

const models = {
  User,
  Ledger,
  LedgerRow,
  Outbox
};

async function createAllIndexes() {
  try {
    console.log(`Connecting to MongoDB: ${MONGODB_URI}`)
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Successfully connected to MongoDB.');

    for (const modelName in models) {
      if (models.hasOwnProperty(modelName)) {
        console.log(`Ensuring indexes for ${modelName}...`);
        await models[modelName].createIndexes();
        console.log(`Indexes for ${modelName} ensured successfully.`);
      }
    }

    console.log('All indexes ensured successfully.');
  } catch (error) {
    console.error('Error during index creation:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
}

createAllIndexes(); 
