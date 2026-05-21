/**
 * seedReferralTree.js
 * ────────────────────────────────────────────────────────────────
 * Usage:  node scripts/seedReferralTree.js [rootUsername]
 *
 * Creates:
 *   • 5  L1 users  (direct referrals of root user)
 *   • 13 L2 users  (2-3 per L1 user)
 *   • LedgerRow  NFT_PURCHASE rows so TSC earnings show in Summary
 *   • Updates directDownlines + communitySize on all affected users
 *
 * Safe to re-run: skips users that already exist (by username).
 * Does NOT delete any existing data.
 * ────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── Models ────────────────────────────────────────────────────────
const User      = require('../models/User');
const LedgerRow = require('../models/LedgerRow');

// ── Config ────────────────────────────────────────────────────────
const MONGO_URI    = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
const ROOT_USERNAME = process.argv[2] || null; // optional CLI arg

// ── Dummy user definitions ────────────────────────────────────────
// L1 = 5 direct children of root
const L1_DEFS = [
  { username: 'alice_ref',  email: 'alice_ref@dummy.com',  nfts: 2, stakes: 1, tscEarned: 125.5  },
  { username: 'bob_ref',    email: 'bob_ref@dummy.com',    nfts: 1, stakes: 2, tscEarned: 87.25  },
  { username: 'carol_ref',  email: 'carol_ref@dummy.com',  nfts: 3, stakes: 0, tscEarned: 210.0  },
  { username: 'dave_ref',   email: 'dave_ref@dummy.com',   nfts: 0, stakes: 3, tscEarned: 63.75  },
  { username: 'eve_ref',    email: 'eve_ref@dummy.com',    nfts: 1, stakes: 1, tscEarned: 99.0   },
];

// L2 = 2-3 per L1 user (index maps to L1_DEFS index)
const L2_DEFS = [
  // Children of alice_ref (L1[0])
  { username: 'ali_l2a',  email: 'ali_l2a@dummy.com',  parentIdx: 0, nfts: 1, stakes: 1 },
  { username: 'ali_l2b',  email: 'ali_l2b@dummy.com',  parentIdx: 0, nfts: 0, stakes: 2 },
  { username: 'ali_l2c',  email: 'ali_l2c@dummy.com',  parentIdx: 0, nfts: 2, stakes: 0 },
  // Children of bob_ref (L1[1])
  { username: 'bob_l2a',  email: 'bob_l2a@dummy.com',  parentIdx: 1, nfts: 1, stakes: 0 },
  { username: 'bob_l2b',  email: 'bob_l2b@dummy.com',  parentIdx: 1, nfts: 0, stakes: 1 },
  // Children of carol_ref (L1[2])
  { username: 'car_l2a',  email: 'car_l2a@dummy.com',  parentIdx: 2, nfts: 2, stakes: 1 },
  { username: 'car_l2b',  email: 'car_l2b@dummy.com',  parentIdx: 2, nfts: 1, stakes: 2 },
  { username: 'car_l2c',  email: 'car_l2c@dummy.com',  parentIdx: 2, nfts: 0, stakes: 1 },
  // Children of dave_ref (L1[3])
  { username: 'dav_l2a',  email: 'dav_l2a@dummy.com',  parentIdx: 3, nfts: 1, stakes: 1 },
  { username: 'dav_l2b',  email: 'dav_l2b@dummy.com',  parentIdx: 3, nfts: 0, stakes: 0 },
  // Children of eve_ref  (L1[4])
  { username: 'eve_l2a',  email: 'eve_l2a@dummy.com',  parentIdx: 4, nfts: 2, stakes: 0 },
  { username: 'eve_l2b',  email: 'eve_l2b@dummy.com',  parentIdx: 4, nfts: 1, stakes: 1 },
  { username: 'eve_l2c',  email: 'eve_l2c@dummy.com',  parentIdx: 4, nfts: 0, stakes: 2 },
];

// ── Helpers ───────────────────────────────────────────────────────
let uhidCounter = 900000;
const nextUhid = () => `DUM${++uhidCounter}`;

function buildNftPackages(count) {
  const tiers = ['starter', 'growth', 'premium'];
  return Array.from({ length: count }, (_, i) => ({
    nftType: 'horse',
    tier: tiers[i % 3],
    mintPrice: [500, 1000, 5000][i % 3],
    purchaseDate: new Date(Date.now() - Math.random() * 60 * 86400000),
    status: 'active',
    bonusTokens: [5000, 12000, 75000][i % 3],
    roi: ['Up to 15%', 'Up to 25%', 'Up to 35%'][i % 3],
    dividendFreq: ['Quarterly', 'Monthly', 'Weekly'][i % 3],
  }));
}

function buildStakingPlans(count) {
  const days = [30, 90, 180, 365];
  return Array.from({ length: count }, (_, i) => ({
    amount: [500, 1000, 2000, 5000][i % 4],
    days: days[i % 4],
    startDate: new Date(Date.now() - Math.random() * 30 * 86400000),
    status: 'active',
    tokenAmount: [5000, 12000, 25000, 75000][i % 4],
  }));
}

async function upsertUser(def, sponsorId, level, pathArr) {
  let user = await User.findOne({ username: def.username });
  if (user) {
    console.log(`  ↩  Skipping (exists): ${def.username}`);
    return user;
  }

  const hashedPw = await bcrypt.hash('Dummy@1234', 10);
  const nftPackages   = buildNftPackages(def.nfts   || 0);
  const stakingPlans  = buildStakingPlans(def.stakes || 0);

  user = new User({
    username:       def.username,
    email:          def.email,
    uhid:           nextUhid(),
    password:       hashedPw,
    isVerified:     true,
    isOtpVerified:  true,
    isEmailVerified:true,
    sponsorId:      sponsorId,
    path:           pathArr,
    level:          level,
    communitySize:  0,
    directDownlines:0,
    nftPackages,
    stakingPlans,
    stakingPlan: stakingPlans[0] || { amount: 0, days: 30, status: 'active', tokenAmount: 0 },
    joiningTimeStamp: new Date(Date.now() - Math.random() * 120 * 86400000),
    registrationTs:   new Date(Date.now() - Math.random() * 120 * 86400000),
    userType: 'user',
  });

  // Disable post-save ledger hook side effect — save directly
  await User.collection.insertOne(user.toObject());
  console.log(`  ✔  Created: ${def.username}  (L${level})`);
  return user;
}

async function createLedgerRow(rootUserId, minterId, tscAmount, label) {
  // Check if already exists to avoid duplicates on re-run
  const exists = await LedgerRow.findOne({
    userId: rootUserId,
    refId:  minterId.toString(),
    eventType: 'NFT_PURCHASE',
    narrative: { $regex: label },
  });
  if (exists) return;

  await LedgerRow.create({
    userId:    rootUserId,
    eventType: 'NFT_PURCHASE',
    walletFrom:'EXTERNAL',
    walletTo:  'BOOST',
    amount:    mongoose.Types.Decimal128.fromString(String((tscAmount * 0.1).toFixed(4))),
    tscAmount: mongoose.Types.Decimal128.fromString(String(tscAmount.toFixed(4))),
    ratePct:   mongoose.Types.Decimal128.fromString('10'),
    narrative: `${label} referral bonus from ${minterId.toString().slice(-6)}`,
    refId:     minterId.toString(),
    status:    'COMPLETED',
  });
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱  Referral Tree Seed Script');
  console.log('════════════════════════════════════════');

  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB:', MONGO_URI.split('@').pop() || MONGO_URI);

  // 1. Find root user
  let rootUser;
  if (ROOT_USERNAME) {
    rootUser = await User.findOne({ username: ROOT_USERNAME });
    if (!rootUser) {
      console.error(`❌  Root user "${ROOT_USERNAME}" not found.`);
      process.exit(1);
    }
  } else {
    // Default: first non-dummy admin or user
    rootUser = await User.findOne({
      username: { $not: /_(ref|l2)/ },
      userType: { $in: ['admin', 'superadmin', 'user'] },
    }).sort({ createdAt: 1 });
    if (!rootUser) {
      console.error('❌  No root user found. Pass a username: node scripts/seedReferralTree.js <username>');
      process.exit(1);
    }
  }

  console.log(`\n👤  Root user: ${rootUser.username}  (${rootUser._id})`);

  // 2. Create L1 users
  console.log('\n── Creating L1 users ──────────────────');
  const l1Users = [];
  for (const def of L1_DEFS) {
    const u = await upsertUser(
      def,
      rootUser._id,
      1,
      [...(rootUser.path || []), rootUser._id],
    );
    l1Users.push(u);
  }

  // 3. Create L2 users
  console.log('\n── Creating L2 users ──────────────────');
  const l2Users = [];
  for (const def of L2_DEFS) {
    const parent = l1Users[def.parentIdx];
    const u = await upsertUser(
      def,
      parent._id,
      2,
      [...(parent.path || []), parent._id],
    );
    l2Users.push({ user: u, parentIdx: def.parentIdx });
  }

  // 4. Create LedgerRow TSC earnings for root user
  console.log('\n── Creating LedgerRow TSC earnings ────');
  for (let i = 0; i < l1Users.length; i++) {
    const l1u   = l1Users[i];
    const tsc   = L1_DEFS[i].tscEarned;
    await createLedgerRow(rootUser._id, l1u._id, tsc, 'L1');
    console.log(`  ✔  L1 TSC row: ${L1_DEFS[i].username} → ${tsc} TSC`);
  }
  // L2 TSC earnings (5% rate, smaller amounts)
  for (const { user: l2u, parentIdx } of l2Users) {
    const tsc = parseFloat((Math.random() * 40 + 10).toFixed(4));
    await createLedgerRow(rootUser._id, l2u._id, tsc, 'L2');
    console.log(`  ✔  L2 TSC row: ${l2u.username} → ${tsc} TSC`);
  }

  // 5. Update directDownlines + communitySize
  console.log('\n── Updating counters ───────────────────');

  // Root user: directDownlines = l1 count, communitySize = l1 + l2
  await User.updateOne(
    { _id: rootUser._id },
    { $set: { directDownlines: l1Users.length, communitySize: l1Users.length + l2Users.length } }
  );
  console.log(`  ✔  ${rootUser.username}: directDownlines=${l1Users.length}, communitySize=${l1Users.length + l2Users.length}`);

  // Each L1 user: directDownlines = count of their L2 children
  for (let i = 0; i < l1Users.length; i++) {
    const children = l2Users.filter(({ parentIdx }) => parentIdx === i);
    await User.updateOne(
      { _id: l1Users[i]._id },
      { $set: { directDownlines: children.length, communitySize: children.length } }
    );
    console.log(`  ✔  ${L1_DEFS[i].username}: directDownlines=${children.length}, communitySize=${children.length}`);
  }

  // L2 users: no children
  for (const { user: l2u } of l2Users) {
    await User.updateOne(
      { _id: l2u._id },
      { $set: { directDownlines: 0, communitySize: 0 } }
    );
  }
  console.log(`  ✔  All L2 users set directDownlines=0, communitySize=0`);

  // 6. Summary
  console.log('\n════════════════════════════════════════');
  console.log('🎉  Seed complete!');
  console.log(`   Root : ${rootUser.username}`);
  console.log(`   L1   : ${l1Users.length} users`);
  console.log(`   L2   : ${l2Users.length} users`);
  console.log(`   Total: ${l1Users.length + l2Users.length} referral nodes added`);
  console.log('\n   Now open: http://localhost:3000/team-referrals');
  console.log('════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌  Fatal error:', err.message);
  process.exit(1);
});
