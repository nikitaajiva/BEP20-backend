const mongoose = require('mongoose');
const { Schema } = mongoose;

const LedgerSchema = new Schema({
  _id: {
    type: Schema.Types.ObjectId, // Explicitly defining _id to match userId
    ref: 'User',
    required: true
  },
  uhid: {
    type: String,
    required: true,
    index: true
  },
  swiftWalletSet: {
    type: Boolean,
    default: false
  },
  lpWalletSet: {
    type: Boolean,
    default: false
  },
  userId: { // Storing userId explicitly for easier querying, though _id is the same
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // Ensure one ledger per user
    index: true
  },
  totalRewardsCredited: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  totalRewardsWithdrawal: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  currentLp: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  wallets: {
    swift: {
      type: Schema.Types.Decimal128,
      default: '0.0' // Initial airdrop balance
    },
    airdrop: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    lp: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    boost: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    bnb: { // Native BNB deposits
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    zeroRisk: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
     zeroRiskIpfs: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    autopositionting: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    communityRewards: { // Changed from 'community' to 'communityRewards' for clarity
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    cascadeRewards: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    dailyCascadeRewards: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    rankBonus: { // Lifetime rank bonus total
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    dailyRankBonus: { // Daily rank bonus, reset each day
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    levelBoosterBonus: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0.00')
    },
    dailyLevelBoosterBonus: {
      type: Schema.Types.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0.00')
    },
    communityBoosterBonus: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    // Adding X bonus related fields
    xBonus: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    },
    dailyXBonus: {
      type: Schema.Types.Decimal128,
      default: '0.0'
    }
  },
  dailyRewards: {
  x1Rewards: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  xPowerRewards: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  communityBoosterRewards: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  dailyRewardsLp: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  dailyRewardsAirdrop: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  dailyRewardsBoost: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  dailyCascadeRewards: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  total: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  date: {
    type: Date,               // 👈 very important
    index: true
  }
},


  // Track negative net deposits in zero-risk wallet (if withdrawals exceed deposits)
  zeroRiskNegativeBalance: {
    type: Schema.Types.Decimal128,
    default: '0.0'
  },
  pendingWithdrawal: {
    // --- Legacy fields (keep for backward compatibility & indexing) ---
    idempotencyKey: String, // same as uniqueTransactionId – indexed for deduplication
    uniqueTransactionId: String,
    walletFrom: String,
    amount: { type: Schema.Types.Decimal128, default: 0 },
    timestamp: { type: Date, default: Date.now },
    lastChecked: Date,

    // --- Fine-grained breakdown to guarantee perfect reversal ---
    amountFromUsdt: Number,
    amountFromLp: Number,
    amountFromRewards: Number,
    zeroRisk: Number,
    airdrop: Number,
    sponsorBoost: Number,
  },
  // Flag to temporarily disable further withdrawals while a previous one is pending on-chain
  withdrawalDisabled: {
    type: Boolean,
    default: false,
    index: true
  },
  processedTransactions: [{
    transactionId: { type: String, required: true, unique: true },
    timestamp: { type: Date, required: true },
    amount: { type: Schema.Types.Decimal128, required: true },
    walletFrom: { type: String, required: true },
    status: { type: String, required: true, enum: ['completed', 'failed'] }
  }],
  limits: {
    swiftLimit: { // Renamed from 'swift' for clarity
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    boostLimit: { // Renamed from 'boost' for clarity
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    lpLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    fiveXLimit: { // Renamed from 'fiveX' for clarity
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    zeroRiskLimit: { // Renamed from 'zeroR' for clarity
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    airdropLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    boosterLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    cascadeLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    xBonusLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    xPowerLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    },
    xMenLimit: {
      cap: { type: Schema.Types.Decimal128, default: '0.0' },
      used: { type: Schema.Types.Decimal128, default: '0.0' }
    }
  }
}, { timestamps: true }); // Added timestamps for tracking creation/updates of the ledger doc itself

// Ensure _id is set to userId when creating a new ledger document
LedgerSchema.pre('save', function(next) {
  if (this.isNew && this.userId && !this._id) {
    this._id = this.userId;
  }
  next();
});

// Add method to check for duplicate transaction
LedgerSchema.methods.hasProcessedTransaction = function(transactionId) {
  return this.processedTransactions.some(tx => tx.transactionId === transactionId);
};

module.exports = mongoose.models.Ledger || mongoose.model('Ledger', LedgerSchema); 
