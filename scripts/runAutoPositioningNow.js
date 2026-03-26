require("dotenv").config();
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User"); // or { User } depending on your export
const { runAutopositioningForUser } = require("../controllers/ledgerController");

(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected successfully");
     const BLOCKED_UHIDS = [
      1753898284391,
      1758789312402,
      1757359069852,
      1765813521617,
    ];
    
    
    console.log("🚀 Manual AutoPositioning started");
      //  const users = await User.find({
      //    xRank: null
      //  });


// const users = await User.find({
//   xRank: { $in: ["X2", "X3", "X4", "X5"] }
// });
// const users = await User.find({
//   username: {
//     $in: [
//       "ahmadaaysha5",
//       "xrp3rakesh",
//       "saanchi0052858",
//       "ahmadaayasha5"
//     ]
//   }
// });


 const users = await User.find({ autopositioning: true });

    if (!users.length) {
      console.log("⚠️ No users found with autopositioning enabled");
      return mongoose.connection.close();
    }


    console.log(`📋 Found ${users.length} users with autopositioning enabled`);

    // for (const user of users) {
    //   console.log(`⚙️ Running autopositioning for: ${user.username} (${user._id})`);
    //   await runAutopositioningForUser(user);
    // }

  for (const user of users) {
      // 🔒 SKIP BLOCKED UHIDs
      if (BLOCKED_UHIDS.includes(Number(user.uhid))) {
        console.log(
          `⏭ SKIPPED autopositioning for blocked user: ${user.username} (UHID: ${user.uhid})`
        );
        continue;
      }
      console.log(`⚙️ Running autopositioning for: ${user.username} (${user._id})`);
      await runAutopositioningForUser(user);
    }
    console.log("✅ Manual AutoPositioning completed successfully.");
  } catch (err) {
    console.error("❌ Error during manual autopositioning:", err);
  } finally {
    mongoose.connection.close();
  }
})();
