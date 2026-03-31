const mongoose = require('mongoose');
const User = require('../../models/User');
const Level = require('../../models/Level');
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const CommunityBoosterReward = require('../../models/CommunityBoosterReward');
const { getTeamVolume } = require('../../utils/teamUtils');
const { 
    addDecimal128, 
    multiplyDecimal128, 
    ensureDecimal128,
    compareDecimal128 
} = require('../../utils/decimal128Utils');

// Community Positioning Tiers Configuration
const COMMUNITY_TIERS = {
    10000: {
        directRequired: 2000,    // Volume required from level 1 users
        teamRequired: 10000,     // Volume required from levels 1-3
        bonusLevel: 1,           // Which cascade level to double
        baseRate: 0.12          // Original cascade rate that will be doubled
    },
    20000: {
        directRequired: 6000,
        teamRequired: 20000,
        bonusLevel: 2,
        baseRate: 0.10
    },
    30000: {
        directRequired: 12000,
        teamRequired: 30000,
        bonusLevel: 3,
        baseRate: 0.07
    }
};

// Cascade level requirements (matching bonusController logic)
const CASCADE_REQUIREMENTS = [
    { level: 1, minDirects: 1, minSelfLP: 9 },
    { level: 2, minDirects: 2, minSelfLP: 9 },
    { level: 3, minDirects: 3, minSelfLP: 9 }
];

/**
 * Check if a user meets cascade level requirements
 */
async function checkCascadeRequirements(userUhid, level) {
    // Get direct referral count
    const directCount = await Level.countDocuments({ parent: userUhid, level: 1 });
    
    // Get self LP
    const ledger = await Ledger.findOne({ uhid: userUhid }).select('wallets.lp').lean();
    const selfLP = ledger ? parseFloat(ledger.wallets.lp.toString()) : 0;

    const requirement = CASCADE_REQUIREMENTS[level - 1];
   // 
    return directCount >= requirement.minDirects && selfLP >= requirement.minSelfLP;
}

/**
 * Processes community booster rewards when a user makes an LP deposit
 */
const handleCommunityBooster = async (payload) => {
    const { depositorUserId, depositAmount, triggeringEventId } = payload;
    const depositAmountD128 = ensureDecimal128(depositAmount);

    try {
        // Get the depositor's info
        const depositor = await User.findById(depositorUserId).lean();
        if (!depositor) {
            
            return;
        }

        // Start with the depositor's UHID
        let currentChildUhid = depositor.uhid;
        let level = 1;
        const processedUplines = new Set();

        while (level <= 3 && currentChildUhid) {
            // Find the upline at this level
            const uplineRecord = await Level.findOne({ 
                child: currentChildUhid,
                level: 1  // Always look for direct parent
            }).populate('parent').lean();

            if (!uplineRecord || !uplineRecord.parent || processedUplines.has(uplineRecord.parent)) {
                break; // No more uplines to process
            }

            // Get upline's user document
            const uplineUser = await User.findOne({ uhid: uplineRecord.parent }).lean();
            if (!uplineUser) {
                break;
            }

            
            processedUplines.add(uplineUser._id.toString());

            // First check if this level is open based on cascade requirements
            const levelIsOpen = await checkCascadeRequirements(uplineUser.uhid, level);
            if (!levelIsOpen) {
                
                // Move to next upline
                currentChildUhid = uplineUser.uhid;
                level++;
                continue;
            }

            // Calculate volumes
            const directVolume = await getTeamVolume(uplineUser.uhid, 1);
            const teamVolume = await getTeamVolume(uplineUser.uhid, 3);

            // Check qualification for each tier
            for (const [tierVolume, tierConfig] of Object.entries(COMMUNITY_TIERS)) {
                // Only process if this tier's bonus applies to current level
                if (tierConfig.bonusLevel === level) {
                    const meetsDirectRequirement = directVolume >= tierConfig.directRequired;
                    const meetsTeamRequirement = teamVolume >= tierConfig.teamRequired;

                    if (meetsDirectRequirement && meetsTeamRequirement) {
                        
                        
                        // Calculate bonus
                        const bonusRateD128 = ensureDecimal128(tierConfig.baseRate.toString());
                        const bonusAmount = multiplyDecimal128(depositAmountD128, bonusRateD128);

                        // Create reward record
                        await CommunityBoosterReward.create({
                            userId: uplineUser._id,
                            triggeringUserId: depositor._id,
                            triggeringEventId,
                            amount: bonusAmount,
                            rate: bonusRateD128,
                            level,
                            tier: parseInt(tierVolume),
                            narrative: `Community Booster Bonus (Level ${level} at ${tierConfig.baseRate * 100}%) from ${depositor.username}'s deposit of ${depositAmount} USDT`
                        });

                        // Update upline's ledger
                        const uplineLedger = await Ledger.findOne({ userId: uplineUser._id });
                        if (uplineLedger) {
                            uplineLedger.wallets.communityBoosterBonus = addDecimal128(
                                ensureDecimal128(uplineLedger.wallets.communityBoosterBonus || '0'),
                                bonusAmount
                            );
                            uplineLedger.limits.fiveXLimit.used = addDecimal128(
                                ensureDecimal128(uplineLedger.limits.fiveXLimit.used || '0'),
                                bonusAmount
                            );
                            uplineLedger.wallets.totalRewardsCredited = addDecimal128(
                                ensureDecimal128(uplineLedger.wallets.totalRewardsCredited || '0'),
                                bonusAmount
                            );
                            await uplineLedger.save();
                        }

                        
                    }
                }
            }

            // Move to next upline
            currentChildUhid = uplineUser.uhid;
            level++;
        }

    } catch (error) {
        console.error('[CommunityBooster] Error processing community booster rewards:', error);
        throw error;
    }
};

module.exports = {
    handleCommunityBooster,
    COMMUNITY_TIERS,
    CASCADE_REQUIREMENTS
}; 
