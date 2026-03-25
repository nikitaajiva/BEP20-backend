const mongoose = require('mongoose');
const { Decimal128 } = mongoose.Types;
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const { getOrCreateLedger } = require('../helpers/ledgerHelpers');
const { add, multiply, convertToFloat } = require('../../utils/decimal128Utils');

const RANKS_CONFIG = [
    { rank: 'X5', selfLP: 20000, teamLP: 1500000, wingLP: 500000, rate: 0.50 },
    { rank: 'X4', selfLP: 12000, teamLP: 900000, wingLP: 300000, rate: 0.40 },
    { rank: 'X3', selfLP: 6000, teamLP: 300000, wingLP: 100000, rate: 0.30 },
    { rank: 'X2', selfLP: 3000, teamLP: 120000, wingLP: 40000, rate: 0.25 },
    { rank: 'X1', selfLP: 1500, teamLP: 30000, wingLP: 10000,  rate: 0.20 },
];

const RANK_RATES = RANKS_CONFIG.reduce((acc, rank) => {
    acc[rank.rank] = rank.rate;
    return acc;
}, {});

/**
 * Calculates a user's positioning rank on-the-fly.
 * @param {object} user - The user document (lean object).
 * @returns {string|null} The user's rank (e.g., 'X3') or null if they don't qualify for any.
 */
async function calculateUserRank(user) {
    const userLedger = await Ledger.findOne({ userId: user._id }).lean();
    if (!userLedger) {
        return null;
    }

    const selfLP = convertToFloat(userLedger.wallets.lp);
    const totalTeamLP = convertToFloat(user.counters?.totalTeamLp);

    const directReferrals = await User.find({ referredBy: user._id }).select('counters.totalTeamLp').lean();
    const referralTeamLps = directReferrals
        .map(r => convertToFloat(r.counters?.totalTeamLp))
        .sort((a, b) => b - a);

    for (const rankInfo of RANKS_CONFIG) {
        if (selfLP < rankInfo.selfLP || totalTeamLP < rankInfo.teamLP) {
            continue;
        }

        const wing1 = referralTeamLps.length > 0 ? referralTeamLps[0] : 0;
        const wing2 = referralTeamLps.length > 1 ? referralTeamLps[1] : 0;
        const otherWingsTotal = referralTeamLps.slice(2).reduce((sum, lp) => sum + lp, 0);

        if (wing1 >= rankInfo.wingLP && wing2 >= rankInfo.wingLP && otherWingsTotal >= rankInfo.wingLP) {
            return rankInfo.rank; // Return the highest qualified rank
        }
    }

    return null;
}

/**
 * Handles the recurring differential positioning bonus for each DAILY_REWARDS_LP event.
 * @param {object} payload - The event payload.
 * @param {string} payload.depositorUserId - The user who received the daily LP reward.
 * @param {string} payload.depositAmount - The amount of the daily LP reward.
 * @param {string} payload.triggeringEventId - The ID of the LedgerRow event.
 */
const handlePositioningBonus = async (payload) => {
    const { depositorUserId, depositAmount, triggeringEventId } = payload;

    const depositor = await User.findById(depositorUserId).lean();
    if (!depositor) {
        console.error(`[PositioningBonus] Depositor with ID ${depositorUserId} not found.`);
        return;
    }

    const depositAmountD128 = Decimal128.fromString(depositAmount.toString());
    let lastPaidRate = 0;
    let currentUserId = depositor.referredBy;

    console.log(`[PositioningBonus] Starting calculation for event ${triggeringEventId}, amount ${depositAmount}.`);

    while (currentUserId) {
        const uplineUser = await User.findById(currentUserId).lean();
        if (!uplineUser) {
            break;
        }

        const rank = await calculateUserRank(uplineUser);

        if (rank && RANK_RATES[rank]) {
            const currentRate = RANK_RATES[rank];
            const differentialRate = currentRate - lastPaidRate;

            if (differentialRate > 0) {
                const bonusAmount = multiply(depositAmountD128, differentialRate);

                const uplineLedger = await getOrCreateLedger(uplineUser._id);
                const balanceBefore = uplineLedger.wallets.rankBonus;

                // 1. Update daily and lifetime rank bonus wallets
                uplineLedger.wallets.dailyRankBonus = add(uplineLedger.wallets.dailyRankBonus, bonusAmount);
                uplineLedger.wallets.rankBonus = add(uplineLedger.wallets.rankBonus, bonusAmount);

                // 2. Update total community rewards
                uplineLedger.wallets.communityRewards = add(uplineLedger.wallets.communityRewards, bonusAmount);

                // 3. Update usage limits
                uplineLedger.limits.fiveXLimit.used = add(uplineLedger.limits.fiveXLimit.used, bonusAmount);
                uplineLedger.limits.zeroRiskLimit.used = add(uplineLedger.limits.zeroRiskLimit.used, bonusAmount);
                
                await uplineLedger.save();

                await LedgerRow.create({
                    userId: uplineUser._id,
                    uhid: uplineUser.uhid,
                    eventId: triggeringEventId,
                    eventType: 'POSITIONING_BONUS_DIFFERENTIAL',
                    amount: bonusAmount,
                    description: `Positioning Bonus (${(differentialRate * 100).toFixed(2)}%) from user ${depositor.username} for event ${triggeringEventId}`,
                    balance_before: balanceBefore,
                    balance_after: uplineLedger.wallets.rankBonus,
                });

                console.log(`[PositioningBonus] Awarded ${bonusAmount.toString()} to ${uplineUser.username} (Rank: ${rank}).`);
                lastPaidRate = currentRate;
            }
        }

        if (lastPaidRate === RANK_RATES['X5']) {
            break;
        }

        currentUserId = uplineUser.referredBy;
    }
};

module.exports = {
    handlePositioningBonus
}; 