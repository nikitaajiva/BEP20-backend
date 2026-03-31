/**
 * Rebuild Full Upline Chain For Single User
 *
 * Usage:
 * node scripts/rebuild_single_user_chain.js --user 1752397762508 --dry
 * node scripts/rebuild_single_user_chain.js --user 1752397762508
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Levels = require("../models/Level");
const User = require("../models/User");

// -------------------------------
// Native CLI argument parsing
// -------------------------------

const userUhid = process.argv.includes("--user")
  ? process.argv[process.argv.indexOf("--user") + 1]
  : null;

const isDryRun = process.argv.includes("--dry");

if (!userUhid) {
  
  
  console.log(
    "node scripts/rebuild_single_user_chain.js --user USER_UHID [--dry]"
  );
  process.exit(1);
}

async function run() {
  try {
    await connectDB();
    

    
    
    
    

    // ======================================
    // STEP 1: Get Level 1 (Direct Sponsor)
    // ======================================

    const level1 = await Levels.findOne({
      child: userUhid,
      level: 1
    }).lean();

    if (!level1) {
      
      process.exit(1);
    }

    const directSponsor = level1.parent;

    const directSponsorUser = await User.findOne({
      uhid: directSponsor
    }).lean();

    
    console.log(
      `Level 1 → UHID: ${directSponsor} | Username: ${
        directSponsorUser ? directSponsorUser.username : "NOT FOUND"
      }\n`
    );

    // ======================================
    // STEP 2: Get Full Chain of Direct Sponsor
    // ======================================

    const sponsorChain = await Levels.find({
      child: directSponsor
    })
      .sort({ level: 1 })
      .lean();

    const rebuiltParents = [directSponsor];

    for (const item of sponsorChain) {
      rebuiltParents.push(item.parent);
    }

    // ======================================
    // PREVIEW NEW CHAIN
    // ======================================

    

    for (let i = 0; i < rebuiltParents.length; i++) {
      const uhid = rebuiltParents[i];

      const user = await User.findOne({ uhid }).lean();

      console.log(
        `Level ${i + 1} → UHID: ${uhid} | Username: ${
          user ? user.username : "NOT FOUND"
        }`
      );
    }

    

    if (isDryRun) {
      
      process.exit(0);
    }

    // ======================================
    // STEP 3: Delete Old Levels (except level 1)
    // ======================================

    await Levels.deleteMany({
      child: userUhid,
      level: { $gt: 1 }
    });

    // ======================================
    // STEP 4: Insert New Levels (2+)
    // ======================================

    const newDocs = rebuiltParents.slice(1).map((parent, index) => ({
      child: userUhid,
      parent,
      level: index + 2,
      timestamp_mongoose_created: new Date(),
      timestamp_mongoose_updated: new Date()
    }));

    if (newDocs.length > 0) {
      await Levels.insertMany(newDocs);
    }

    
    
    

    process.exit(0);

  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

run();
