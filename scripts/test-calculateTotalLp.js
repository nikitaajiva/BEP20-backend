const mongoose = require('mongoose');
const path = require('path');

// --- Mongoose Models ---

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


// --- Main Test Logic ---

async function testCalculateTotalTeamLp() {
  

  // 1. Find 10 distinct parent users to test with using an aggregation pipeline
  const parentUhidsResult = await Level.aggregate([
    { $group: { _id: '$parent' } },
    { $limit: 10 }
  ]);
  const testParentUhids = parentUhidsResult.map(p => p._id);

  if (testParentUhids.length === 0) {
    
    return;
  }
  

  // 2. Fetch and log the "before" state for these users
  const usersBefore = await User.find({ uhid: { $in: testParentUhids } }).select('uhid counters.totalTeamLp');
  
  

  // 3. Run the aggregation pipeline for ONLY these 10 parents
  const pipeline = [
    { $match: { parent: { $in: testParentUhids }, level: { $gte: 1, $lte: 16 } } },
    { $lookup: { from: 'ledgers', localField: 'child', foreignField: 'uhid', as: 'ledgerInfo' } },
    { $unwind: '$ledgerInfo' },
    { $group: { _id: '$parent', totalLp: { $sum: '$ledgerInfo.wallets.lp' } } },
    { $project: { uhid: '$_id', _id: 0, 'counters.totalTeamLp': '$totalLp' } }
  ];
  
  const results = await Level.aggregate(pipeline);

  // 4. Perform the update using the results
  const bulkOps = results.map(res => ({
    updateOne: {
      filter: { uhid: res.uhid },
      update: { $set: { 'counters.totalTeamLp': res.counters.totalTeamLp } }
    }
  }));

  if (bulkOps.length > 0) {
    await User.bulkWrite(bulkOps);
    
  } else {
    
  }

  // 5. Fetch and log the "after" state
  const usersAfter = await User.find({ uhid: { $in: testParentUhids } }).select('uhid counters.totalTeamLp');
  
  

  // 6. Automatically verify the result for the first user
  if (usersAfter.length > 0) {
    const userToVerify = usersAfter[0];
    const expectedLp = userToVerify.counters.totalTeamLp;
    
    await verifyLpForUser(userToVerify.uhid, expectedLp);
  }
}


// --- Verification Function ---

async function verifyLpForUser(uhid, expectedLp) {
  
  
  

  // a. Find all downline children for the user
  const downline = await Level.find({ parent: uhid, level: { $gte: 1, $lte: 16 } }).select('child');
  const childUhids = downline.map(d => d.child);

  if (childUhids.length === 0) {
      
      const actualLp = new mongoose.Types.Decimal128('0');
      const expectedLpStr = expectedLp ? expectedLp.toString() : '0';
      
      
      
      
      
      return;
  }
  

  // b. Provide a spot-check by showing the LP for a few sample members
  const sampleSize = Math.min(childUhids.length, 5);
  const sampleUhids = childUhids.slice(0, sampleSize);
  
  const sampleLedgers = await Ledger.find({ uhid: { $in: sampleUhids } }).select('uhid wallets.lp');
  if (sampleLedgers.length > 0) {
      sampleLedgers.forEach(ledger => {
          
      });
  } else {
      
  }


  // c. Use an aggregation pipeline on ledgers to get the precise sum for ALL downline members.
  
  const verificationPipeline = [
    { $match: { uhid: { $in: childUhids }, 'wallets.lp': { $exists: true } } },
    { $group: { _id: null, totalLp: { $sum: '$wallets.lp' } } }
  ];

  const verificationResult = await Ledger.aggregate(verificationPipeline);
  const actualLp = verificationResult.length > 0 ? verificationResult[0].totalLp : new mongoose.Types.Decimal128('0');

  // d. Final Comparison
  
  
  

  if (actualLp.toString() === expectedLp.toString()) {
      
  } else {
      
  }
}


// --- DB Connection and Execution ---

async function run() {
    const mongoURI = 'mongodb://localhost:27017/xrp2';
    try {
        await mongoose.connect(mongoURI);
        
        await testCalculateTotalTeamLp();
    } catch (error) {
        console.error('Database connection or script execution failed:', error);
    } finally {
        await mongoose.disconnect();
        
    }
}

run(); 
