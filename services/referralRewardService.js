/**
 * referralRewardService.js
 *
 * Handles automatic Referral L1 (10%) and L2 (5%) reward distribution.
 *
 * L1: Direct sponsor of the earner  → earns 10% of the reward
 * L2: Sponsor of the L1 sponsor     → earns  5% of the reward
 *
 * Rewards are credited to wallets.bnb (internal USDT balance).
 * A LedgerRow entry is created for every credit for full audit trail.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const { createLedgerEntry } = require('../jobs/helpers/ledgerHelpers');
const { Decimal128 } = mongoose.Types;

const L1_RATE = 0.10; // 10% of reward
const L2_RATE = 0.05; //  5% of reward

/**
 * Credit USDT to a sponsor's ledger (wallets.bnb).
 * @param {ObjectId} sponsorId
 * @param {number}   amount      - USDT amount to credit
 * @param {string}   eventType   - e.g. 'REFERRAL_L1_REWARD'
 * @param {string}   narrative
 * @param {string}   refId       - source event ID for traceability
 * @param {object|null} session  - optional Mongoose session
 */
async function creditSponsorUsdt({ sponsorId, amount, eventType, narrative, refId, session = null }) {
  if (!sponsorId || amount <= 0) return;

  try {
    // Fetch / ensure ledger
    let query = Ledger.findOne({ userId: sponsorId });
    if (session) query = query.session(session);
    let ledger = await query;

    if (!ledger) {
      // Create minimal ledger if missing
      const sponsorUser = await User.findById(sponsorId).select('uhid').lean();
      if (!sponsorUser) return;

      ledger = new Ledger({
        _id: sponsorId,
        userId: sponsorId,
        uhid: sponsorUser.uhid,
      });
      await ledger.save(session ? { session } : undefined);
    }

    // Credit wallets.bnb
    const current = Decimal128.fromString(
      (ledger.wallets?.bnb || { toString: () => '0.0' }).toString()
    );
    const add = Decimal128.fromString(amount.toFixed(8));
    const newBal = Decimal128.fromString(
      (parseFloat(current.toString()) + parseFloat(add.toString())).toFixed(8)
    );

    ledger.wallets = ledger.wallets || {};
    ledger.wallets.bnb = newBal;
    ledger.markModified('wallets');
    await ledger.save(session ? { session } : undefined);

    // Write ledger row for audit
    await createLedgerEntry(
      {
        userId: sponsorId,
        eventType,
        amount: parseFloat(amount.toFixed(8)),
        walletFrom: 'SYSTEM',
        walletTo: 'USDT',
        narrative,
        refId,
      },
      session
    );

    console.log(
      `[ReferralRewardService] ${eventType} → sponsor ${sponsorId}: +${amount.toFixed(4)} USDT`
    );
  } catch (err) {
    // Never crash the caller; just log
    console.error(
      `[ReferralRewardService] Failed to credit ${eventType} for sponsor ${sponsorId}:`,
      err.message
    );
  }
}

/**
 * Distribute L1 + L2 referral rewards for a given reward event.
 *
 * @param {Object} options
 * @param {ObjectId|string} options.earnerId   - User who earned the base reward
 * @param {number}          options.rewardUsdt - Base reward amount in USDT
 * @param {string}          options.refId      - Source record ID for traceability
 * @param {string}          options.rewardType - 'STAKING' | 'MINING'
 * @param {object|null}     options.session    - Mongoose session (optional)
 */
async function distributeReferralRewards({ earnerId, rewardUsdt, refId, rewardType = 'REWARD', session = null }) {
  if (!earnerId || !rewardUsdt || rewardUsdt <= 0) return;

  try {
    // Fetch earner to get L1 sponsor
    const earner = await User.findById(earnerId).select('sponsorId username').lean();
    if (!earner || !earner.sponsorId) return;

    const l1SponsorId = earner.sponsorId;
    const l1Amount = parseFloat((rewardUsdt * L1_RATE).toFixed(8));

    await creditSponsorUsdt({
      sponsorId: l1SponsorId,
      amount: l1Amount,
      eventType: `REFERRAL_L1_${rewardType}`,
      narrative: `L1 Referral Reward (10%) from ${earner.username || earnerId} ${rewardType} reward`,
      refId,
      session,
    });

    // Fetch L1 sponsor to get L2 sponsor
    const l1Sponsor = await User.findById(l1SponsorId).select('sponsorId username').lean();
    if (!l1Sponsor || !l1Sponsor.sponsorId) return;

    const l2SponsorId = l1Sponsor.sponsorId;
    const l2Amount = parseFloat((rewardUsdt * L2_RATE).toFixed(8));

    await creditSponsorUsdt({
      sponsorId: l2SponsorId,
      amount: l2Amount,
      eventType: `REFERRAL_L2_${rewardType}`,
      narrative: `L2 Referral Reward (5%) from ${earner.username || earnerId} via ${l1Sponsor.username || l1SponsorId}`,
      refId,
      session,
    });
  } catch (err) {
    console.error('[ReferralRewardService] distributeReferralRewards error:', err.message);
  }
}

module.exports = {
  distributeReferralRewards,
};
