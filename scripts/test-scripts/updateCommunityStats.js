const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

/**
 * updateCommunityStats.js
 * -------------------------------------------------------------
 * Recalculates 1️⃣ communitySize 2️⃣ counters.totalTeamLp for each user
 * whose descendants were added by the hierarchy rebuild described in
 * `query.js` (i.e. where at least one child UHID is < 17498803170).
 *
 * Usage:
 *   node updateCommunityStats.js               # live run
 *   node updateCommunityStats.js --dry-run     # preview only
 *   node updateCommunityStats.js --limit 100   # process first 100 parents
 *
 * NOTE: This script purposefully uses lightweight schemas declared
 * inline to avoid model overwrite warnings when run alongside the
 * rest of the code-base.
 */

// -------------------------- CLI OPTIONS --------------------------
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  limit: (() => {
    const idx = args.indexOf('--limit');
    return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
  })()
};

// -------------------------- MONGOOSE MODELS ----------------------
const UserSchema = new mongoose.Schema({
  uhid: { type: String, index: true, unique: true },
  communitySize: Number,
  counters: {
    totalTeamLp: mongoose.Schema.Types.Decimal128
  }
}, { strict: false, collection: 'users' });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

const LevelSchema = new mongoose.Schema({
  parent: { type: String, index: true },
  child: { type: String, index: true },
  level: Number
}, { strict: false, collection: 'levels' });
const Level = mongoose.models.Level || mongoose.model('Level', LevelSchema);

const LedgerSchema = new mongoose.Schema({
  uhid: { type: String, index: true },
  wallets: {
    lp: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }
  }
}, { strict: false, collection: 'ledgers' });
const Ledger = mongoose.models.Ledger || mongoose.model('Ledger', LedgerSchema);

// -------------------------- MAIN LOGIC ---------------------------
async function run() {
  const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
  await mongoose.connect(dbURI, { useNewUrlParser: true, useUnifiedTopology: true });
  
  

  const threshold = 17498803170;
  const parentSet = new Set();

  console.time('Scanning levels');
  const levelCursor = Level.find({}, { parent: 1, child: 1 }).cursor();
  for await (const doc of levelCursor) {
    if (Number(doc.child) < threshold) {
      parentSet.add(doc.parent);
    }
  }
  console.timeEnd('Scanning levels');
  

  const parents = Array.from(parentSet);
  if (options.limit) parents.splice(options.limit);

  let updated = 0;
  for (const uhid of parents) {
    try {
      // 1️⃣ Calculate community size
      const communitySize = await Level.countDocuments({ parent: uhid, level: { $gte: 1 } });

      // 2️⃣ Gather children UHIDs for LP sum
      const childUhids = await Level.distinct('child', { parent: uhid });

      let totalTeamLp = mongoose.Types.Decimal128.fromString('0');
      if (childUhids.length > 0) {
        const agg = await Ledger.aggregate([
          { $match: { uhid: { $in: childUhids } } },
          { $group: { _id: null, total: { $sum: '$wallets.lp' } } }
        ]);
        const total = agg.length ? agg[0].total : '0.0';
        totalTeamLp = mongoose.Types.Decimal128.fromString(parseFloat(total).toFixed(4));
      }

      if (options.dryRun) {
        
      } else {
        await User.updateOne(
          { uhid },
          { $set: { communitySize, 'counters.totalTeamLp': totalTeamLp } }
        );
        updated += 1;
        
      }
    } catch (err) {
      console.error(`Error processing ${uhid}:`, err.message);
    }
  }

  
  
  if (!options.dryRun) 

  await mongoose.disconnect();
  
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
}); 
