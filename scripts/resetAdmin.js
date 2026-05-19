const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');
const Ledger = require('../models/Ledger');

const resetAdmin = async () => {
  const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
  
  try {
    await mongoose.connect(dbURI);
    console.log('Connected to MongoDB');

    let user = await User.findOne({ email: 'admin4@gmail.com' });

    if (user) {
      user.password = '123456';
      user.isVerified = true;
      user.isEmailVerified = true;
      user.userType = 'superadmin';
      await user.save();
      console.log('User admin4@gmail.com updated. Password reset to 123456');
    } else {
      user = new User({
        email: 'admin4@gmail.com',
        username: 'admin4',
        uhid: 'UHID' + Math.floor(Math.random() * 1000000000),
        password: '123456',
        isVerified: true,
        isEmailVerified: true,
        userType: 'superadmin',
      });
      await user.save();
      console.log('User admin4@gmail.com created. Password set to 123456');
    }

    // Ensure ledger exists
    let ledger = await Ledger.findOne({ userId: user._id });
    if (!ledger) {
      ledger = new Ledger({
        _id: user._id,
        userId: user._id,
        uhid: user.uhid,
      });
    }
    
    // Set individual wallet subfields
    ledger.wallets.swift = '500.0';
    ledger.wallets.airdrop = '250.0';
    ledger.wallets.zeroRisk = '120.0';
    ledger.wallets.sol = '1.5';
    ledger.wallets.lp = '1000.0';
    ledger.wallets.boost = '300.0';
    
    // Set individual limits subfields
    ledger.limits.swiftLimit = { cap: '1500.0', used: '0.0' };
    ledger.limits.boostLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.lpLimit = { cap: '2000.0', used: '0.0' };
    ledger.limits.fiveXLimit = { cap: '5000.0', used: '0.0' };
    ledger.limits.zeroRiskLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.airdropLimit = { cap: '500.0', used: '0.0' };
    ledger.limits.boosterLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.cascadeLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.xBonusLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.xPowerLimit = { cap: '1000.0', used: '0.0' };
    ledger.limits.xMenLimit = { cap: '1000.0', used: '0.0' };

    await ledger.save();
    console.log('Ledger updated successfully with individual subfields.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

resetAdmin();
