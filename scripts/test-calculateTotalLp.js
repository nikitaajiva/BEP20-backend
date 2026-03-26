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
  console.log('Starting Total Team LP calculation test...');

  // 1. Find 10 distinct parent users to test with using an aggregation pipeline
  const parentUhidsResult = await Level.aggregate([
    { $group: { _id: '$parent' } },
    { $limit: 10 }
  ]);
  const testParentUhids = parentUhidsResult.map(p => p._id);

  if (testParentUhids.length === 0) {
    console.log('Could not find any parent users to test with. Please check your `levels` data.');
    return;
  }
  console.log(`Found ${testParentUhids.length} parent users to test. UHIDs:`, testParentUhids);

  // 2. Fetch and log the "before" state for these users
  const usersBefore = await User.find({ uhid: { $in: testParentUhids } }).select('uhid counters.totalTeamLp');
  console.log('\n--- DATA BEFORE UPDATE ---');
  console.log(usersBefore.map(u => ({ uhid: u.uhid, totalTeamLp: u.counters.totalTeamLp?.toString() || 'N/A' })));

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
    console.log('\nUpdate operation completed.');
  } else {
    console.log('\nNo updates to perform. The selected users may not have any downline LP.');
  }

  // 5. Fetch and log the "after" state
  const usersAfter = await User.find({ uhid: { $in: testParentUhids } }).select('uhid counters.totalTeamLp');
  console.log('\n--- DATA AFTER UPDATE ---');
  console.log(usersAfter.map(u => ({ uhid: u.uhid, totalTeamLp: u.counters.totalTeamLp?.toString() || 'N/A' })));

  // 6. Automatically verify the result for the first user
  if (usersAfter.length > 0) {
    const userToVerify = usersAfter[0];
    const expectedLp = userToVerify.counters.totalTeamLp;
    console.log(`\n--- VERIFYING RESULT for user ${userToVerify.uhid} ---`);
    await verifyLpForUser(userToVerify.uhid, expectedLp);
  }
}


// --- Verification Function ---

async function verifyLpForUser(uhid, expectedLp) {
  console.log(`\n--- VERIFICATION AUDIT for user ${uhid} ---`);
  console.log(`The main script calculated a totalTeamLp of: ${expectedLp.toString()}`);
  console.log('Now, running an independent calculation to confirm this value...');

  // a. Find all downline children for the user
  const downline = await Level.find({ parent: uhid, level: { $gte: 1, $lte: 16 } }).select('child');
  const childUhids = downline.map(d => d.child);

  if (childUhids.length === 0) {
      console.log('\n[Audit Step 1] Found 0 downline members.');
      const actualLp = new mongoose.Types.Decimal128('0');
      const expectedLpStr = expectedLp ? expectedLp.toString() : '0';
      console.log(`[Audit Step 2] Independent Sum: ${actualLp.toString()}`);
      console.log(`\n[Result] Comparing the two values:`);
      console.log(`  - Main Script:     ${expectedLpStr}`);
      console.log(`  - Verification:    ${actualLp.toString()}`);
      console.log(expectedLpStr === actualLp.toString() ? '✅ AUDIT PASSED: The values match.' : '❌ AUDIT FAILED: The values do not match.');
      return;
  }
  console.log(`\n[Audit Step 1] Found ${childUhids.length} total downline members.`);

  // b. Provide a spot-check by showing the LP for a few sample members
  const sampleSize = Math.min(childUhids.length, 5);
  const sampleUhids = childUhids.slice(0, sampleSize);
  console.log(`\n[Audit Step 2] Spot-checking the LP for the first ${sampleSize} downline members...`);
  const sampleLedgers = await Ledger.find({ uhid: { $in: sampleUhids } }).select('uhid wallets.lp');
  if (sampleLedgers.length > 0) {
      sampleLedgers.forEach(ledger => {
          console.log(`  - Child ${ledger.uhid} has LP: ${ledger.wallets.lp.toString()}`);
      });
  } else {
      console.log('  - No ledgers found for the sample UHIDs.');
  }


  // c. Use an aggregation pipeline on ledgers to get the precise sum for ALL downline members.
  console.log(`\n[Audit Step 3] Calculating the precise total LP for all ${childUhids.length} members using database aggregation...`);
  const verificationPipeline = [
    { $match: { uhid: { $in: childUhids }, 'wallets.lp': { $exists: true } } },
    { $group: { _id: null, totalLp: { $sum: '$wallets.lp' } } }
  ];

  const verificationResult = await Ledger.aggregate(verificationPipeline);
  const actualLp = verificationResult.length > 0 ? verificationResult[0].totalLp : new mongoose.Types.Decimal128('0');

  // d. Final Comparison
  console.log(`\n[Result] Comparing the final calculated values:`);
  console.log(`  - Main Script Result:        ${expectedLp.toString()}`);
  console.log(`  - Independent Audit Result:  ${actualLp.toString()}`);

  if (actualLp.toString() === expectedLp.toString()) {
      console.log('\n✅ AUDIT PASSED: The two independent calculations match perfectly.');
  } else {
      console.log('\n❌ AUDIT FAILED: The results do not match.');
  }
}


// --- DB Connection and Execution ---

async function run() {
    const mongoURI = 'mongodb://localhost:27017/xrp2';
    try {
        await mongoose.connect(mongoURI);
        console.log('MongoDB connected successfully.');
        await testCalculateTotalTeamLp();
    } catch (error) {
        console.error('Database connection or script execution failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB connection closed.');
    }
}

run(); 