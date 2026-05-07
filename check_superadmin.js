const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkUser() {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ username: 'superadmin' });
  console.log('User found:', user ? {
    _id: user._id,
    username: user.username,
    email: user.email,
    wallet_address: user.wallet_address
  } : 'Not found');
  await mongoose.disconnect();
}

checkUser();
