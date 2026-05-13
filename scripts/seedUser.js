const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');
const Ledger = require('../models/Ledger');

const seedUser = async () => {
  const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
  
  const userData = {
    email: 'admin3@gmail.com',
    username: 'admin3',
    uhid: 'UHID' + Math.floor(Math.random() * 1000000000),
    password: '123456',
    isVerified: true,
    isEmailVerified: true,
    userType: 'user', // Change to 'admin' or 'superadmin' if needed
  };

  try {
    await mongoose.connect(dbURI);
    console.log('Connected to MongoDB');

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: userData.email },
        { username: userData.username }
      ] 
    });

    if (user) {
      console.log(`User with email ${userData.email} or username ${userData.username} already exists.`);
    } else {
      user = new User(userData);
      await user.save();
      console.log(`User created successfully: ${user.username} (${user.email})`);
      console.log(`UHID: ${user.uhid}`);
      
      // The Ledger is created automatically via User post-save hook.
      // Let's verify and maybe set some initial balances.
      const ledger = await Ledger.findOne({ userId: user._id });
      if (ledger) {
        console.log('Ledger created successfully.');
        
        // Optional: Set some initial balances for testing
        ledger.wallets.swift = '100.0';
        ledger.wallets.airdrop = '50.0';
        ledger.limits.swiftLimit.cap = '1000.0';
        
        await ledger.save();
        console.log('Initial balances seeded in ledger.');
      }
    }

  } catch (error) {
    console.error('Error seeding user:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

seedUser();
