const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Create write stream for logging
const logStream = fs.createWriteStream(path.join(__dirname, 'lp.log'), { flags: 'w' });

// Helper function to log to both console and file
function log(message, writeToFile = true) {
  
  if (writeToFile) {
    logStream.write(message + '\n');
  }
}

// Check if verification is enabled via command line flag
const VERIFY = process.argv.includes('--verify');

// --- Mongoose Models with re-registration to avoid OverwriteModelError ---

const UserSchema = new mongoose.Schema({
  uhid: { type: String, unique: true, required: true },
  counters: {
    totalTeamLp: { type: mongoose.Schema.Types.Decimal128 }
  }
}, { strict: false, collection: 'users' });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const LevelSchema = new mongoose.Schema({
  parent: { type: String, required: true, index: true },
  child: { type: String, required: true, index:true },
  level: { type: Number, required: true, index: true },
}, { strict: false, collection: 'levels' });
const Level = mongoose.models.Level || mongoose.model('Level', LevelSchema);

const LedgerSchema = new mongoose.Schema({
  uhid: { type: String, required: true, index: true },
  wallets: {
    lp: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }
  }
}, { strict: false, collection: 'ledgers' });
const Ledger = mongoose.models.Ledger || mongoose.model('Ledger', LedgerSchema);

// --- Verification Function ---

async function verifyLpForUser(uhid, expectedLp) {
  
  
  

  // Find all downline children for the user
  const downline = await Level.find({ parent: uhid, level: { $gte: 1, $lte: 16 } }).select('child');
  const childUhids = downline.map(d => d.child);

  if (childUhids.length === 0) {
    
    const actualLp = new mongoose.Types.Decimal128('0');
    const expectedLpStr = expectedLp ? expectedLp.toString() : '0';
    
    
    
    
    
    return;
  }

  

  // Spot-check sample members
  const sampleSize = Math.min(childUhids.length, 5);
  const sampleUhids = childUhids.slice(0, sampleSize);
  
  const sampleLedgers = await Ledger.find({ uhid: { $in: sampleUhids } }).select('uhid wallets.lp');
  if (sampleLedgers.length > 0) {
    sampleLedgers.forEach(ledger => {
      
    });
  }

  // Calculate precise sum for all downline members
  
  const verificationPipeline = [
    { $match: { uhid: { $in: childUhids }, 'wallets.lp': { $exists: true } } },
    { $group: { _id: null, totalLp: { $sum: '$wallets.lp' } } }
  ];

  const verificationResult = await Ledger.aggregate(verificationPipeline);
  const actualLp = verificationResult.length > 0 ? verificationResult[0].totalLp : new mongoose.Types.Decimal128('0');

  // Final Comparison
  
  
  

  if (actualLp.toString() === expectedLp.toString()) {
    
  } else {
    
  }
}

// --- Main Script Logic ---

async function calculateTotalLp() {
  log('Starting Total Team LP calculation...', false);
  if (VERIFY) {
    log('Verification mode is enabled.', false);
  }

  // First, get a count of total users to process
  const totalUsers = await Level.distinct('parent');
  log(`Found ${totalUsers.length} users to process.`, false);

  const pipeline = [
    // 1. Find all downline relationships up to 16 levels
    {
      $match: {
        level: { $gte: 1, $lte: 16 }
      }
    },
    // 2. Join with ledgers collection to get the LP balance of each child
    {
      $lookup: {
        from: 'ledgers',
        localField: 'child',
        foreignField: 'uhid',
        as: 'ledgerInfo'
      }
    },
    // 3. Deconstruct the ledgerInfo array and filter out children with no ledger
    {
      $unwind: '$ledgerInfo'
    },
    // 4. Group by the parent and collect all children's info
    {
      $group: {
        _id: '$parent',
        totalLp: {
          $sum: {
            // Only sum wallets.lp if it's greater than 0
            $cond: [
              { $gt: ['$ledgerInfo.wallets.lp', new mongoose.Types.Decimal128('0')] },
              '$ledgerInfo.wallets.lp',
              new mongoose.Types.Decimal128('0')
            ]
          }
        },
        downlines: {
          $push: {
            uhid: '$child',
            lp: '$ledgerInfo.wallets.lp',
            level: '$level' // Include level for detailed logging
          }
        }
      }
    },
    // 5. Reshape the data to match the users collection for merging
    {
      $project: {
        uhid: '$_id',
        _id: 0,
        counters: {
          totalTeamLp: '$totalLp'
        },
        downlines: 1
      }
    }
  ];

  try {
    log('Executing aggregation pipeline...', false);
    log('Step 1: Starting aggregation...', false);
    console.time('Aggregation Time');
    
    const results = await Level.aggregate(pipeline);
    console.timeEnd('Aggregation Time');
    log(`Aggregation completed. Found ${results.length} results.`, false);
    
    if (results.length === 0) {
      
      // Check if we have any levels data
      const levelCount = await Level.countDocuments();
      
      
      // Check if we have any ledgers data
      const ledgerCount = await Ledger.countDocuments();
      
      
      // Check sample of levels
      const sampleLevels = await Level.find().limit(5);
      
      
      // Check sample of ledgers
      const sampleLedgers = await Ledger.find().limit(5);
      
    }

    // Perform bulk update with progress tracking
    let processedCount = 0;
    const bulkOps = results.map(res => {
      // Only log users with LP > 0
      if (res.counters.totalTeamLp && res.counters.totalTeamLp.toString() !== '0') {
        log(`\nProcessing for user ${res.uhid}`);
        
        // Group downlines by level for structured logging
        const downlinesByLevel = res.downlines.reduce((acc, downline) => {
          const level = downline.level;
          if (!acc[level]) {
            acc[level] = [];
          }
          acc[level].push(downline);
          
          return acc;
        }, {});

        // Log downlines level by level from 1 to 16
        for (let i = 1; i <= 16; i++) {
          log(`found downlines at level ${i}`);
          const levelDownlines = downlinesByLevel[i] || [];
          const contributingDownlines = levelDownlines.filter(d => d.lp && d.lp.toString() !== '0' && d.lp.toString() !== '0.0');
          
          if (contributingDownlines.length > 0) {
            contributingDownlines.forEach(downline => {
              log(`  uhid: ${downline.uhid} - self LP: ${downline.lp.toString()}`);
            });
          }
        }
        
        log(`\nUpdating LP for ${res.uhid}: ${res.counters.totalTeamLp.toString()}`);
        log('----------------------------------------');
      } else {
        // Only log to console for users with 0 LP
        
      }
      
      processedCount++;
      if (processedCount % 50 === 0) {
        log(`\n=== Progress Update ===`, false);
        log(`  ${results.length - processedCount} users remaining`, false);
        log(`=====================\n`, false);
      }

      return {
        updateOne: {
          filter: { uhid: res.uhid },
          update: { $set: { 'counters.totalTeamLp': res.counters.totalTeamLp } }
        }
      };
    });

    if (bulkOps.length > 0) {
      await User.bulkWrite(bulkOps);
      log('Successfully updated totalTeamLp for all users.', false);

      // Only verify if verification is enabled
      if (VERIFY) {
        const sampleSize = Math.min(results.length, 5);
        log(`\nVerifying ${sampleSize} random users...`, false);
        for (let i = 0; i < sampleSize; i++) {
          const randomUser = results[Math.floor(Math.random() * results.length)];
          await verifyLpForUser(randomUser.uhid, randomUser.counters.totalTeamLp);
        }
      }
    } else {
      log('No updates to perform.', false);
    }
  } catch (error) {
    log('An error occurred during the aggregation: ' + error.message, false);
    throw error;
  }
}

// --- DB Connection and Execution ---

async function run() {
  
  try {
    await mongoose.connect("mongodb://localhost:27017/xrpmigrate");
    
    log('MongoDB connected successfully.', false);
    await calculateTotalLp();
  } catch (error) {
    log('Database connection or script execution failed: ' + error.message, false);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    log('MongoDB connection closed.', false);
    // Close the log stream
    logStream.end();
  }
}

run(); 
