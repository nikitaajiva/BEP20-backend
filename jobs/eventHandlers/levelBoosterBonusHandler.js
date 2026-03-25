const mongoose = require('mongoose');
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
const Level = require('../../models/Level');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { getOrCreateLedger } = require('../helpers/ledgerHelpers');
const { addDecimal128, multiplyDecimal128, convertToFloat } = require('../../utils/decimal128Utils');

// The qualification rules are now simpler. Each level has one bonus rate.
const QUALIFICATION_LEVELS = [
    { level: 1, teamVolume: 10000, directVolume: 2000, bonusRate: 0.12 },
    { level: 2, teamVolume: 20000, directVolume: 6000, bonusRate: 0.10 },
    { level: 3, teamVolume: 30000, directVolume: 12000, bonusRate: 0.07 },
];

const getTeamVolume = async (userUhid, maxLevel = 3) => {
    const childrenRecords = await Level.find({ parent: userUhid, level: { $gte: 1, $lte: maxLevel } }).select('child').lean();
    if (childrenRecords.length === 0) return 0;
    const childrenUhids = childrenRecords.map(c => c.child);
    const ledgers = await Ledger.find({ uhid: { $in: childrenUhids } }).select('wallets.lp').lean();
    return ledgers.reduce((sum, ledger) => sum + convertToFloat(ledger.wallets.lp), 0);
};

const getDirectReferralVolume = async (userUhid) => {
    const directReferralRecords = await Level.find({ parent: userUhid, level: 1 }).select('child').lean();
    if (directReferralRecords.length === 0) return 0;
    
    const directReferralUhids = directReferralRecords.map(c => c.child);
    const ledgers = await Ledger.find({ uhid: { $in: directReferralUhids } }).select('wallets.lp').lean();
    return ledgers.reduce((sum, ledger) => sum + convertToFloat(ledger.wallets.lp), 0);
};

/**
 * @param {string} payload.triggeringEventId - The ID of the LedgerRow event.
 */
const handleLevelBoosterBonus = async (payload) => {
    // Step 1: Initialize variables from the payload.
    const { depositorUserId, depositAmount, triggeringEventId } = payload;
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(depositAmount.toString());

    // Step 2: Fetch the user who triggered the event (the depositor).
    const depositor = await User.findById(depositorUserId).lean();
    if (!depositor) {
        console.log(`[LevelBooster] Depositor user ${depositorUserId} not found.`);
        return;
    }

    // Step 3: Loop up to 3 levels up the referral chain.
    let level = 1;
    while (level <= 3) {
        // Find the sponsor at the current level.
        const levelRecord = await Level.findOne({ child: depositor.uhid, level: level }).lean();
        if (!levelRecord || !levelRecord.parent) {
            // Stop if no sponsor is found at this level.
            break;
        }

        // Fetch the full user document for the sponsor.
        const uplineUser = await User.findOne({ uhid: levelRecord.parent }).lean();
        if (!uplineUser) {
            console.log(`[LevelBooster] Upline user at level ${level} not found. Stopping cascade.`);
            break;
        }

        // Step 4: Check if the sponsor qualifies for the bonus AT THIS SPECIFIC LEVEL.
        // Find the qualification rule that corresponds to the sponsor's level.
        const requiredQualification = QUALIFICATION_LEVELS.find(q => q.level === level);

        // This should not happen, but it's a good safeguard.
        if (!requiredQualification) {
            console.log(`[LevelBooster] No qualification rule found for level ${level}.`);
            level++;
            continue;
        }

        // Calculate the sponsor's team and direct referral LP.
        const teamVolume = await getTeamVolume(uplineUser.uhid);
        const directVolume = await getDirectReferralVolume(uplineUser.uhid);
        console.log(`[LevelBooster] Team Volume: ${teamVolume}, Direct Volume: ${directVolume}`);
        // Check if the sponsor meets the specific requirements for this level.
        const isQualified = (teamVolume >= requiredQualification.teamVolume && directVolume >= requiredQualification.directVolume);
        
        // Step 5: If the sponsor is qualified for this specific level, award the bonus.
        if (isQualified) {
            // Get the bonus percentage for this specific level.
            const bonusPercent = requiredQualification.bonusRate;
            const bonusAmount = multiplyDecimal128(depositAmountD128, bonusPercent);

            // Get the sponsor's ledger and log its state before the update.
            const uplineLedger = await getOrCreateLedger(uplineUser._id);
            const ledgerBeforeUpdate = JSON.parse(JSON.stringify(uplineLedger.toObject()));
            
            // Update the relevant wallets.
            uplineLedger.wallets.dailyLevelBoosterBonus = addDecimal128(uplineLedger.wallets.dailyLevelBoosterBonus, bonusAmount);
            uplineLedger.wallets.levelBoosterBonus = addDecimal128(uplineLedger.wallets.levelBoosterBonus, bonusAmount);
            uplineLedger.wallets.communityRewards = addDecimal128(uplineLedger.wallets.communityRewards, bonusAmount);
            uplineLedger.limits.fiveXLimit.used = addDecimal128(uplineLedger.limits.fiveXLimit.used, bonusAmount);
            uplineLedger.limits.zeroRiskLimit.used = addDecimal128(uplineLedger.limits.zeroRiskLimit.used, bonusAmount);
            
            // Save the updated ledger.
            await uplineLedger.save();

            // Create a log entry for this transaction.
            const description = `Level Booster Bonus (Level ${level} - ${bonusPercent * 100}%) from user ${depositor.username}`;
            await DailyRewardLog.create({
                userId: uplineUser._id,
                date: new Date(),
                rewardType: 'levelBoosterBonus',
                amount: bonusAmount,
                details: {
                    triggeringUserId: depositor._id,
                    triggeringEventId: new mongoose.Types.ObjectId(triggeringEventId),
                    description: description,
                    level: level,
                    rate: mongoose.Types.Decimal128.fromString(bonusPercent.toString())
                }
            });
            console.log(`[LevelBooster] Awarded ${bonusAmount.toString()} to ${uplineUser.username} (Level ${level}).`);
            console.log(`--- Ledger BEFORE for ${uplineUser.username}: \n${JSON.stringify(ledgerBeforeUpdate, null, 2)}`);
            console.log(`--- Ledger AFTER for ${uplineUser.username}: \n${JSON.stringify(uplineLedger.toObject(), null, 2)}`);
        } else {
             // Log that the sponsor did not qualify for THIS SPECIFIC LEVEL's requirements.
             console.log(`[LevelBooster] Upline user ${uplineUser.username} at level ${level} did not meet Level ${level} requirements. Team Volume: ${teamVolume}, Direct Volume: ${directVolume}`);
        }

        // Move to the next level up.
        level++;
    }
};

module.exports = {
    handleLevelBoosterBonus,
}; 