const mongoose = require('mongoose');
const Ledger = require('../../models/Ledger'); // Adjust path relative to this file
const LedgerRow = require('../../models/LedgerRow'); // Adjust path relative to this file
const { Decimal128 } = mongoose.Types;

/**
 * Creates a new row in the ledger history.
 * @param {object} details - The details for the ledger entry.
 */
const createLedgerEntry = async ({
  userId,
  eventType,
  amount,
  walletFrom,
  walletTo,
  narrative,
  refId,
  transactionId
}, session = null) => {
  const ledgerEntry = new LedgerRow({
    userId,
    eventType,
    amount: Decimal128.fromString(amount.toString()),
    walletFrom,
    walletTo,
    narrative,
    refId,
    transactionId,
    timestamp: new Date()
  });

  if (session) {
    await ledgerEntry.save({ session });
  } else {
    await ledgerEntry.save();
  }

  return ledgerEntry;
};

/**
 * Retrieves a user's ledger, creating it if it doesn't exist.
 * @param {string|mongoose.Types.ObjectId} userId - The ID of the user.
 * @returns {Promise<Ledger>} The user's ledger document.
 */
async function getOrCreateLedger(userId) {
    let ledger = await Ledger.findById(userId);
    if (!ledger) {
        
        // Note: The User.post('save') hook that also creates a ledger will not
        // be part of this session, so creating it here explicitly is necessary
        // for operations on users who might not have had a ledger before.
        ledger = new Ledger({
            _id: userId, 
            userId: userId,
            // Initial default values
            wallets: {
                swift: Decimal128.fromString('0.0'),
                lp: Decimal128.fromString('0.0'),
                boost: Decimal128.fromString('0.0'),
                bnb: Decimal128.fromString('0.0'),
                zeroRisk: Decimal128.fromString('0.0'),
                communityRewards: Decimal128.fromString('0.0'),
                airdrop: Decimal128.fromString('0.0'),
                cascadeRewards:Decimal128.fromString('0.0'),
                rankRewards: Decimal128.fromString('0.0'),
                dailyCascadeRewards: Decimal128.fromString('0.0'),
                dailyLevelBoosterBonus: Decimal128.fromString('0.0'),
                dailyRankBonus:Decimal128.fromString('0.0'),
                levelBoosterBonus: Decimal128.fromString('0.0'),
                rankBonus: Decimal128.fromString('0.0'),
                communityBoosterBonus:Decimal128.fromString('0.0'),
                dailyXBonus:Decimal128.fromString('0.0'),
                xBonus:Decimal128.fromString('0.0'),
            },
            limits: {
                swiftLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                boostLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                fiveXLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                zeroRiskLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
            }
        });
        await ledger.save();
    }
    // No need to manually ensure Decimal128 types if schema is correct.
    // The save operations in depositService will handle the updates.
    return ledger;
}

module.exports = {
    createLedgerEntry,
    getOrCreateLedger
}; 
