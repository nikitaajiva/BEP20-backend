const mongoose = require('mongoose');
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { decimal128ToFloat, multiply, add } = require('../../utils/decimal128Utils');

const getTeamVolume = async (userId, maxLevel) => {
    const user = await User.findOne({ userId }).lean();
    if (!user) return 0;

    let teamVolume = 0;
    let queue = [{ user, level: 0 }];
    const visited = new Set();
    visited.add(user.userId);

    while (queue.length > 0) {
        const { user: currentUser, level } = queue.shift();

        if (level >= maxLevel) continue;

        const referrals = await User.find({ referredBy: currentUser.userId }).lean();
        for (const referral of referrals) {
            if (!visited.has(referral.userId)) {
                const ledger = await Ledger.findOne({ userId: referral.userId }).lean();
                if (ledger && ledger.wallets && ledger.wallets.LP) {
                    teamVolume += decimal128ToFloat(ledger.wallets.LP);
                }
                visited.add(referral.userId);
                queue.push({ user: referral, level: level + 1 });
            }
        }
    }
    return teamVolume;
};

const getDirectReferralVolume = async (userId) => {
    const referrals = await User.find({ referredBy: userId }).lean();
    let directVolume = 0;
    for (const referral of referrals) {
        const ledger = await Ledger.findOne({ userId: referral.userId }).lean();
        if (ledger && ledger.wallets && ledger.wallets.LP) {
            directVolume += decimal128ToFloat(ledger.wallets.LP);
        }
    }
    return directVolume;
};

const QUALIFICATION_LEVELS = [
    { rank: 1, teamVolume: 10000, directVolume: 2000, bonuses: { 1: 0.24 } },
    { rank: 2, teamVolume: 20000, directVolume: 6000, bonuses: { 1: 0.24, 2: 0.20 } },
    { rank: 3, teamVolume: 30000, directVolume: 12000, bonuses: { 1: 0.24, 2: 0.20, 3: 0.14 } },
];

const handleLevelBooster = async (payload) => {
    const { depositorUserId, depositAmount, triggeringEventId } = payload;
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(depositAmount.toString());

    let currentUser = await User.findOne({ userId: depositorUserId }).lean();
    if (!currentUser) {
        console.log(`[LevelBooster] Depositor user ${depositorUserId} not found.`);
        return;
    }

    let level = 1;
    let currentUplineId = currentUser.referredBy;

    while (currentUplineId && level <= 3) {
        const uplineUser = await User.findOne({ userId: currentUplineId }).lean();
        if (!uplineUser) {
            console.log(`[LevelBooster] Upline user ${currentUplineId} not found. Stopping cascade.`);
            break;
        }

        const teamVolume = await getTeamVolume(uplineUser.userId, 3);
        const directVolume = await getDirectReferralVolume(uplineUser.userId);

        let bestQualification = null;
        for (const ql of QUALIFICATION_LEVELS) {
            if (teamVolume >= ql.teamVolume && directVolume >= ql.directVolume) {
                bestQualification = ql;
            }
        }

        if (bestQualification && bestQualification.bonuses[level]) {
            const bonusPercent = bestQualification.bonuses[level];
            const bonusAmount = multiply(depositAmountD128, bonusPercent);

            const uplineLedger = await Ledger.findOne({ userId: uplineUser.userId });

            if (uplineLedger) {
                const currentBalance = uplineLedger.wallets.levelBoosterBonus || mongoose.Types.Decimal128.fromString('0');
                uplineLedger.wallets.levelBoosterBonus = add(currentBalance, bonusAmount);
                
                await uplineLedger.save();
                
                const description = `Level Booster Bonus (Level ${level} - ${bonusPercent * 100}%) from user ${depositorUserId}`;
                await DailyRewardLog.create({
                    userId: uplineUser.userId,
                    date: new Date(),
                    rewardType: 'levelBoosterBonus',
                    amount: bonusAmount,
                    details: {
                        triggeringUserId: new mongoose.Types.ObjectId(depositorUserId),
                        triggeringEventId: new mongoose.Types.ObjectId(triggeringEventId),
                        description: description,
                        level: level,
                        rate: mongoose.Types.Decimal128.fromString(bonusPercent.toString())
                    }
                });

                console.log(`[LevelBooster] Awarded ${bonusAmount.toString()} to ${uplineUser.userId} (Level ${level})`);
            }
        } else {
             console.log(`[LevelBooster] Upline user ${uplineUser.userId} did not qualify for bonus at Level ${level}. Team Volume: ${teamVolume}, Direct Volume: ${directVolume}`);
        }

        currentUplineId = uplineUser.referredBy;
        level++;
    }
};

module.exports = {
    handleLevelBooster,
}; 