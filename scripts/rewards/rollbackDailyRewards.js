const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');

// Models
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');

// Helpers
const toFloat = (d) => d ? parseFloat(d.toString()) : 0;
const fromFloat = (f) => Decimal128.fromString(f.toString());

const EVENT_TYPE_TO_LIMIT_FIELD = {
  'DAILY_REWARDS_LP': 'lpLimit',
  'DAILY_REWARDS_AIRDROP': 'airdropLimit',
  'DAILY_REWARDS_BOOST': 'boostLimit'
};

async function connectDB() {
  await mongoose.connect('mongodb://localhost:27017/xrpmigrate', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  
}

async function rollbackDailyRewards() {
  await connectDB();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const eventTypes = Object.keys(EVENT_TYPE_TO_LIMIT_FIELD);

  const rows = await LedgerRow.find({
    eventType: { $in: eventTypes },
    ts: { $gte: todayStart }
  }).lean();

  if (rows.length === 0) {
    
    return mongoose.disconnect();
  }

  

  let successCount = 0;
  for (const row of rows) {
    const ledger = await Ledger.findOne({ userId: row.userId });
    if (!ledger) {
      console.warn(`Ledger not found for userId=${row.userId}. Skipping row ${row._id}`);
      continue;
    }

    const amt = toFloat(row.amount);
    const limitField = EVENT_TYPE_TO_LIMIT_FIELD[row.eventType];

    // Update wallet balances and limits
    ledger.wallets.communityRewards = fromFloat(toFloat(ledger.wallets.communityRewards) - amt);
    ledger.totalRewardsCredited  = fromFloat(toFloat(ledger.totalRewardsCredited) - amt);
    ledger.limits.fiveXLimit.used = fromFloat(toFloat(ledger.limits.fiveXLimit.used) - amt);
    ledger.wallets.zeroRisk = fromFloat(toFloat(ledger.wallets.zeroRisk) + amt);

    // Specific wallet limit reversal
    if (limitField && ledger.limits[limitField]) {
      ledger.limits[limitField].used = fromFloat(toFloat(ledger.limits[limitField].used) - amt);
    }

    await ledger.save();
    successCount += 1;
  }

  

  // Optionally delete the processed ledger rows
  // await LedgerRow.deleteMany({ _id: { $in: rows.map(r => r._id) } });
  // 

  await mongoose.disconnect();
  
}

rollbackDailyRewards().catch(err => {
  console.error('Rollback script error:', err);
  mongoose.disconnect();
}); 
