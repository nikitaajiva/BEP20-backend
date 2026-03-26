const mongoose = require('mongoose');
const User = require('../models/User'); 
const Ledger = require('../models/Ledger');

// Load environment variables
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });


const resetUserLedger = async (uhid) => {
  if (!uhid) {
    console.error('Error: Please provide a UHID.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully.');

    const user = await User.findOne({ uhid: uhid });
    if (!user) {
      console.error(`Error: User with UHID "${uhid}" not found.`);
      await mongoose.disconnect();
      return;
    }

    console.log(`Found user ${user.username} with ID: ${user._id}`);
    
    const userId = user._id;

    const ledgerUpdateResult = await Ledger.updateOne(
      { userId: userId },
      {
        $set: {
          'wallets.swift': '0.0',
          'wallets.lp': '0.0',
          'wallets.boost': '0.0',
          'wallets.xaman': '0.0',
          'wallets.zeroRisk': '0.0',
          'wallets.communityRewards': '0.0',
          'limits.swiftLimit.cap': '0.0',
          'limits.swiftLimit.used': '0.0',
          'limits.boostLimit.cap': '0.0',
          'limits.boostLimit.used': '0.0',
          'limits.fiveXLimit.cap': '0.0',
          'limits.fiveXLimit.used': '0.0',
          'limits.zeroRiskLimit.cap': '0.0',
          'limits.zeroRiskLimit.used': '0.0',
        }
      }
    );

    const userUpdateResult = await User.updateOne(
        { _id: userId },
        {
            $set: {
                'counters.selfLp': '0.0'
            }
        }
    );

    if (ledgerUpdateResult.nModified > 0 || userUpdateResult.nModified > 0) {
      console.log(`Successfully reset ledger and counters for user with UHID "${uhid}".`);
    } else {
      console.log(`No changes were needed for user with UHID "${uhid}". They might have been in the default state already.`);
    }

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');
  }
};

// Get UHID from command line arguments
const uhid = process.argv[2];
resetUserLedger(uhid); 