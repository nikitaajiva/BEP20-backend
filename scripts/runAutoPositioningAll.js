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
    
     const BLOCKED_UHIDS = [
      1753898284391,
      1758789312402,
      1757359069852,
      1765813521617,
    ];
    
    
    
      //  const users = await User.find({
      //    xRank: null
      //  });


// const users = await User.find({
  // xRank: { $in: ["X1","X2", "X3", "X4", "X5"] }
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


 const users = await User.find({ autopositioning: false });

    if (!users.length) {
      
      return mongoose.connection.close();
    }


    

    // for (const user of users) {
    //   
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
      
      await runAutopositioningForUser(user);
    }
    
  } catch (err) {
    console.error("❌ Error during manual autopositioning:", err);
  } finally {
    mongoose.connection.close();
  }
})();
