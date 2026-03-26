const mongoose = require('mongoose');
require('dotenv').config();

const Ledger = require('../models/Ledger');
const User   = require('../models/User');
const { addDecimal128, subtractDecimal128, ensureDecimal128 } = require('../utils/decimal128Utils');



async function recalcLpBalances() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Optional CLI arg: node recalcLpBalances.js <username-or-uhid>
  const target = process.argv[2];
  let ledgerMatch = {};

  if (target) {
    const user = await User.findOne({
      $or: [
        { username: target },
        { uhid: target },
      ],
    }).select('_id');

    if (!user) {
      console.error('User not found for identifier:', target);
      await mongoose.disconnect();
      process.exit(1);
    }

    ledgerMatch.userId = user._id;
    console.log('Running recalculation for single user', target, '(', user._id.toString(), ')');
  }

  let processed = 0;

  // Aggregate all required totals in one go
  const pipeline = [];
  if (Object.keys(ledgerMatch).length) pipeline.push({ $match: ledgerMatch });

  pipeline.push(
    
    {
      $lookup: {
        from: 'cDeposits',
        let: { uid: '$userId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
          { $group: { _id: null, total: { $sum: '$amountXRP' } } },
        ],
        as: 'chainDep',
      },
    },
    {
      $lookup: {
        from: 'cWithdrawals',
        let: { uid: '$userId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
          { $group: { _id: null, total: { $sum: '$amountXRP' } } },
        ],
        as: 'chainWdl',
      },
    },
    {
      $addFields: {
        rewardsTotal: {
          $ifNull: ['$wallets.limits.fiveXLimit.used', 0],        
        },
        chainDeposits: {
          $ifNull: [{ $arrayElemAt: ['$chainDep.total', 0] }, 0],
        },
        chainWithdrawals: {
          $ifNull: [{ $arrayElemAt: ['$chainWdl.total', 0] }, 0],
        },
      },
    },
    {
      $project: {
        userId: '$userId',
        currentLp: '$wallets.lp',
        communityRewardsWallet: '$wallets.communityRewards',
        xamanWallet: '$wallets.xaman',
        rewardsTotal: 1,
        chainDeposits: 1,
        chainWithdrawals: 1,
      },
    },
  );

  const aggCursor = Ledger.aggregate(pipeline).cursor({ batchSize: 100 });

  for await (const doc of aggCursor) {
    const dRewards  = ensureDecimal128(doc.rewardsTotal);
    const dDep      = ensureDecimal128(doc.chainDeposits);
    const dCRWallet = ensureDecimal128(doc.communityRewardsWallet);
    const dWdl      = ensureDecimal128(doc.chainWithdrawals);
    const dXaman    = ensureDecimal128(doc.xamanWallet);

    // newLp = rewards + chainDep - commRewardsWallet - chainWithdrawals - xamanWallet
    let newLp = addDecimal128(dRewards, dDep);
    newLp = subtractDecimal128(newLp, dCRWallet);
    newLp = subtractDecimal128(newLp, dWdl);
    newLp = subtractDecimal128(newLp, dXaman);
    
    await Ledger.updateOne({ userId: doc.userId }, { $set: { 'wallets.lp': newLp } });
    processed++;
    if (processed % 100 === 0) console.log('Processed', processed, 'ledgers');
  }

  console.log('Recalculation done. Total ledgers processed:', processed);
  await mongoose.disconnect();
}

if (require.main === module) {
  recalcLpBalances().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
} 