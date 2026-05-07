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
    

    // 1. Drop the new reward collections
    
    try {
      await CascadeReward.collection.drop();
      
    } catch (error) {
      if (error.code === 26) {
        
      } else {
        throw error;
      }
    }

    
    try {
      await RankReward.collection.drop();
      
    } catch (error) {
      if (error.code === 26) {
        
      } else {
        throw error;
      }
    }

    // 2. Reset fields on User documents
    
    const userUpdateResult = await User.updateMany({}, {
      $set: {
        positioningRank: null,
        paidRankBonuses: []
      }
    });
    

    // 3. Reset wallet balances on Ledger documents
    
    const ledgerUpdateResult = await Ledger.updateMany({}, {
      $set: {
        'wallets.cascadeRewards': mongoose.Types.Decimal128.fromString('0.0'),
        'wallets.rankRewards': mongoose.Types.Decimal128.fromString('0.0')
      }
    });
    

    

  } catch (error) {
    console.error('An error occurred during cleanup and reset:', error);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      
    }
  }
};

cleanupAndReset(); 
