const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../config/.env') });
const db = require('../../config/db');

const CascadeReward = require('../../models/CascadeReward');
const RankReward = require('../../models/RankReward');
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');

const cleanupAndReset = async () => {
  try {
    await db.connectDB();
    console.log('Starting cleanup and reset process...');

    // 1. Drop the new reward collections
    console.log('Dropping CascadeReward collection...');
    try {
      await CascadeReward.collection.drop();
      console.log('CascadeReward collection dropped successfully.');
    } catch (error) {
      if (error.code === 26) {
        console.log('CascadeReward collection does not exist, skipping drop.');
      } else {
        throw error;
      }
    }

    console.log('Dropping RankReward collection...');
    try {
      await RankReward.collection.drop();
      console.log('RankReward collection dropped successfully.');
    } catch (error) {
      if (error.code === 26) {
        console.log('RankReward collection does not exist, skipping drop.');
      } else {
        throw error;
      }
    }

    // 2. Reset fields on User documents
    console.log('Resetting positioningRank and paidRankBonuses for all users...');
    const userUpdateResult = await User.updateMany({}, {
      $set: {
        positioningRank: null,
        paidRankBonuses: []
      }
    });
    console.log(`${userUpdateResult.modifiedCount} users updated.`);

    // 3. Reset wallet balances on Ledger documents
    console.log('Resetting cascadeRewards and rankRewards wallets to 0 for all ledgers...');
    const ledgerUpdateResult = await Ledger.updateMany({}, {
      $set: {
        'wallets.cascadeRewards': mongoose.Types.Decimal128.fromString('0.0'),
        'wallets.rankRewards': mongoose.Types.Decimal128.fromString('0.0')
      }
    });
    console.log(`${ledgerUpdateResult.modifiedCount} ledgers updated.`);

    console.log('Cleanup and reset process completed successfully.');

  } catch (error) {
    console.error('An error occurred during cleanup and reset:', error);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('MongoDB connection closed.');
    }
  }
};

cleanupAndReset(); 