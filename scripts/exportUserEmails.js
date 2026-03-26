/*
  Export User Emails to CSV
  -------------------------
  Usage:
    node exportUserEmails.js
*/

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const connectDB = require('../config/db');
const User = require('../models/User');

(async function main() {
  try {
    await connectDB();

    console.log('→ Fetching user emails…');
    const users = await User.find({}, { email: 1, username: 1 }).lean();

    if (!users.length) {
      console.log('⚠️ No users found');
      process.exit(0);
    }

    // Prepare CSV header
    let csvContent = "SrNo,Username,Email\n";

    // Add rows
    users.forEach((u, i) => {
      const srNo = i + 1;
      const username = (u.username || '').replace(/,/g, ''); // strip commas
      const email = (u.email || '').replace(/,/g, '');
      csvContent += `${srNo},${username},${email}\n`;
    });

    const fileName = 'users-emails.csv';
    fs.writeFileSync(fileName, csvContent);

    console.log(`✅ Exported ${users.length} emails to ${fileName}`);
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
