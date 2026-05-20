const mongoose = require("mongoose");

const LedgerRowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Index for faster queries on userId
    },
    ts: {
      type: Date,
      default: Date.now,
      index: true, // Index for time-based queries
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "AUTOPOSITIONING", // User AUTOPOSITIONING
        "DEPOSIT_PENDING", // Deposit intent awaiting confirmation
        "DEPOSIT", // User deposits LP
        "AIRDROP_ACTIVATION", // Swift moved to LP during first deposit
        "AIRDROP_BURN", // Unmatched airdrop burned
        "AIRDROP_TRANSFER", // Unmatched airdrop transferred to another user's Swift
        "BOOST_BONUS", // Referral deposit bonus credited to Boost
        "ROI_CREDIT", // Daily ROI credited (from LP, Swift, or Boost to Community-Rewards)
        "ROI_CASCADE", // ROI-on-ROI (Team Cascade) credited to Community-Rewards
        "WITHDRAWAL", // User withdrawal from LP or Community-Rewards
        "REWARDS_REDEEMED", // User redeems from Community Rewards wallet
        "INTERNAL_TRANSFER",
        "LP_DEPOSIT_FROM_USDT", // User moves funds from their USDT wallet to their LP wallet
        "LP_DEPOSIT_FROM_REWARDS",
        "MOCK_SWIFT_CREDIT", // e.g. Swift to LP, or potentially other internal movements
        "SWIFT_TRANSFER_IN", // Swift transfer received from another user
        "SWIFT_TRANSFER_OUT", // Swift transfer sent to another user
        "DAILY_REWARDS_LP",
        "DAILY_REWARDS_SWIFT",
        "DAILY_REWARDS_BOOST",
        "DAILY_REWARDS_COMMUNITY_BOOSTER", // Daily Rewards credited (from Community-Booster) based on each day  from communityboosterrewards collection
        "DAILY_REWARDS_AIRDROP",
        "DAILY_COMMUNITY_REWARDS",
        "X_BONUS_REWARD", // X1-X5 bonus rewards
        "MANUAL_AIRDROP",
        "AUTO_DEBIT",
        "XPOWER_REWARDS",
        "WITHDRAWAL_REFUND", // Manual credit to airdrop wallet by support/admin
        "CLAIM_AUTOPOSITIONED",
        "STAKING_DEPOSIT",
        "NFT_PURCHASE",
        "HORSE_NFT_PURCHASE",
        "HORSE_NFT_PAYOUT"
        // Add more event types as needed
      ],
    },
    walletFrom: {
      type: String,
      // e.g., 'EXTERNAL', 'SWIFT', 'LP', 'BOOST', 'COMMUNITY_REWARDS'
      // Can be null if it's a direct credit like airdrop or initial deposit bonus
    },
    walletTo: {
      type: String,
      // e.g., 'SWIFT', 'LP', 'BOOST', 'COMMUNITY_REWARDS', 'EXTERNAL'
      // Can be null if it's a burn or withdrawal to external
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
    },
    tscAmount: {
      type: mongoose.Schema.Types.Decimal128,
    },
    // Optional: Store balances before/after for easier auditing directly in the row
    // balanceBefore: { type: mongoose.Schema.Types.Decimal128 },
    // balanceAfter: { type: mongoose.Schema.Types.Decimal128 },
    ratePct: {
      // Rate or Percentage slab applied, e.g., for ROI or Boost Bonus
      type: mongoose.Schema.Types.Decimal128,
    },
    narrative: {
      // Description of the transaction, e.g., "ROI from LP wallet at 0.3%"
      type: String,
    },
    refId: {
      // Reference to related documents, e.g., transaction hash, parent ledger row ID for cascades
      type: String,
      index: true,
    },
    referenceId: {
      // Deposit intent reference ID
      type: String,
      index: true,
    },
    txHash: {
      type: String,
      index: true,
    },
    intentAmount: {
      type: mongoose.Schema.Types.Decimal128,
    },
    amountWei: {
      type: String,
    },
    fromAddress: {
      type: String,
    },
    toAddress: {
      type: String,
    },
    blockNumber: {
      type: Number,
    },
    txTimestamp: {
      type: Date,
    },
    txMetadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    txRaw: {
      type: mongoose.Schema.Types.Mixed,
    },
    receiptRaw: {
      type: mongoose.Schema.Types.Mixed,
    },
    asset: {
      type: String,
    },
    network: {
      type: String,
    },
    processingError: {
      type: String,
    },
    // Fields specific to ROI for detailed auditing as per §5.2
    roiWalletSource: { type: String }, // e.g., 'LP', 'SWIFT', 'BOOST' - for ROI_CREDIT events
    roiRateSlabApplied: { type: String }, // e.g., '>=9:0.3%', '>=1000:0.4%' - for ROI_CREDIT events
    roiLimitApplied: { type: String }, // e.g., 'SWIFT_LIMIT', 'BOOST_LIMIT', 'NONE' - for ROI_CREDIT events

    // Flags to track processing by different bonus scripts
    cascadeProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    positioningBonusProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    communityBoosterProcessed: {
      type: Boolean,
      default: false,
      index: true,
    },
    x1Processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Add transactionId field for withdrawal tracking
    transactionId: {
      type: String,
      index: true, // Index for faster duplicate checks
      sparse: true // Only index documents that have this field
    },

    // New unique transaction id for exactly-once withdrawal processing
    uniqueTransactionId: {
      type: String,
      unique: true, // unique implies index creation; no separate index: true to avoid duplicates
      sparse: true
    },
    userip: {
      type: String,
    },

    // Status for withdrawal state machine
    status: {
      type: String,
      enum: [
        'INITIATED',
        'COMPLETED',
        'REFUNDED',
        'FAILED'
      ],
      default: 'INITIATED',
      index: true
    },
    // Timestamp marking when an automatic refund was processed (if applicable)
    refundedAt: {
      type: Date
    }
  },
  { timestamps: { createdAt: "ts" } }
); // Use 'ts' as the primary timestamp field as per schema, `updatedAt` will also be added

// Indexes for fast retrieval
LedgerRowSchema.index({ userId: 1, eventType: 1, refId: 1 });

module.exports = mongoose.models.LedgerRow || mongoose.model("LedgerRow", LedgerRowSchema);
