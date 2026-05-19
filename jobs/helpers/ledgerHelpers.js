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
  transactionId,
  tscAmount,
  ratePct,
  roiDetails,
  ...extraFields
}, session = null) => {
  const ledgerEntry = new LedgerRow({
    userId,
    eventType,
    amount: Decimal128.fromString(amount.toString()),
    tscAmount: tscAmount ? Decimal128.fromString(tscAmount.toString()) : undefined,
    ratePct: ratePct != null ? Decimal128.fromString(ratePct.toString()) : undefined,
    walletFrom,
    walletTo,
    narrative,
    refId,
    transactionId,
    roiWalletSource: roiDetails?.walletSource,
    roiRateSlabApplied: roiDetails?.rateSlab,
    roiLimitApplied: roiDetails?.limitApplied,
    timestamp: new Date(),
    ...extraFields
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
async function getOrCreateLedger(userId, session = null) {
    let ledgerQuery = Ledger.findById(userId);
    if (session) {
        ledgerQuery = ledgerQuery.session(session);
    }

    let ledger = await ledgerQuery;
    if (!ledger) {
        const User = mongoose.model('User');
        let userQuery = User.findById(userId).select('uhid');
        if (session) {
            userQuery = userQuery.session(session);
        }
        const user = await userQuery;
        
        if (!user) {
            throw new Error(`Cannot create ledger: User not found for ID ${userId}`);
        }

        // Note: The User.post('save') hook that also creates a ledger will not
        // be part of this session, so creating it here explicitly is necessary
        // for operations on users who might not have had a ledger before.
        ledger = new Ledger({
            _id: userId, 
            userId: userId,
            uhid: user.uhid, // Explicitly provide uhid to avoid validation failure
            // Initial default values
            wallets: {
                swift: Decimal128.fromString('0.0'),
                lp: Decimal128.fromString('0.0'),
                boost: Decimal128.fromString('0.0'),
                bnb: Decimal128.fromString('0.0'),
                sol: Decimal128.fromString('0.0'),
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
                airdropLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                boosterLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                cascadeLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                xBonusLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                xPowerLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
                xMenLimit: { cap: Decimal128.fromString('0.0'), used: Decimal128.fromString('0.0') },
            }
        });
        await ledger.save(session ? { session } : undefined);
    }
    // No need to manually ensure Decimal128 types if schema is correct.
    // The save operations in depositService will handle the updates.
    return ledger;
}

module.exports = {
    createLedgerEntry,
    getOrCreateLedger
}; 
