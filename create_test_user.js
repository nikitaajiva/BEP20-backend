const mongoose = require('mongoose');
require('./models/Ledger'); // Register Ledger model first
const User = require('./models/User');
require('dotenv').config();

async function createTestUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const email = 'admin2@gmail.com';
    const username = 'admin2';
    const password = '123456';
    const uhid = 'UHID' + Date.now();

    // Check if user exists
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      console.log('Test user already exists:', user.username);
    } else {
      user = new User({
        email,
        username,
        password,
        uhid,
        isVerified: true,
        isEmailVerified: true
      });
      await user.save();
      console.log('Test user created successfully:');
      console.log('Email:', email);
      console.log('Username:', username);
      console.log('Password:', password);
      console.log('UHID:', uhid);
    }
  } catch (err) {
    console.error('Error creating test user:', err);
  } finally {
    await mongoose.disconnect();
  }
}

createTestUser();
