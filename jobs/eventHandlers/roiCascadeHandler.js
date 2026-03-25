const mongoose = require('mongoose');
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
// const Outbox = require('../../models/Outbox'); // Not strictly needed unless this handler emits further events
const { Decimal128 } = mongoose.Types;
const { createLedgerEntry, getOrCreateLedger } = require('../helpers/ledgerHelpers');

// ROI-on-ROI (Team Cascade) Table Data (§6)
const cascadeUnlockRules = [
    // Level, Pct, MinDirects, MinSelfLP, MinTeamLP3, MinTeamLP5 (n/a represented by null or a very high number if checks are direct)
    // Note: For OR conditions (selfLp OR teamLp), logic will need to handle this.
    // Using 0 for LP checks where it means "any amount >= 0" effectively, or a specific small amount like 9 if that's the floor.
    // The table has "selfLp >= 9 OR teamLpFirst3Lvls >= n/a". For n/a, we assume the OR condition focuses on selfLp.
    { level: 1, pct: 0.12, minDirects: 1, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } }, 
    { level: 2, pct: 0.10, minDirects: 2, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
    { level: 3, pct: 0.07, minDirects: 3, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
    { level: 4, pct: 0.05, minDirects: 4, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
    { level: 5, pct: 0.05, minDirects: 5, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
    { level: 6, pct: 0.05, minDirects: 6, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
    { level: 7, pct: 0.03, minDirects: 7, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } }, // Switched to teamLp5
    { level: 8, pct: 0.03, minDirects: 8, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
    { level: 9, pct: 0.03, minDirects: 9, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
    { level: 10, pct: 0.03, minDirects: 10, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
    { level: 11, pct: 0.05, minDirects: 11, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } }, // Note: spec has 30k, seems low vs 150k for L7-10. Assuming correct.
    { level: 12, pct: 0.05, minDirects: 12, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
    { level: 13, pct: 0.05, minDirects: 13, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
    { level: 14, pct: 0.07, minDirects: 14, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
    { level: 15, pct: 0.10, minDirects: 15, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
    { level: 16, pct: 0.12, minDirects: 16, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
];

function checkSponsorUnlock(sponsorCounters, rule) {
    if (sponsorCounters.directReferrals < rule.minDirects) return false;

    const selfLp = sponsorCounters.selfLp.toFloat();

    if (rule.selfLpOrTeamLp3) {
        const meetsSelfLp = selfLp >= rule.selfLpOrTeamLp3.selfLp;
        if (rule.selfLpOrTeamLp3.teamLp3 === null) return meetsSelfLp; // Only selfLp matters
        const meetsTeamLp3 = sponsorCounters.teamLpFirst3Lvls.toFloat() >= rule.selfLpOrTeamLp3.teamLp3;
        return meetsSelfLp || meetsTeamLp3;
    }
    if (rule.selfLpOrTeamLp5) {
        const meetsSelfLp = selfLp >= rule.selfLpOrTeamLp5.selfLp;
        // For teamLp5, it's an OR condition according to table format
        if (rule.selfLpOrTeamLp5.teamLp5 === null) return meetsSelfLp; // Should not happen for L7+
        const meetsTeamLp5 = sponsorCounters.teamLpFirst5Lvls.toFloat() >= rule.selfLpOrTeamLp5.teamLp5;
        return meetsSelfLp || meetsTeamLp5;
    }
    return false; // Should not be reached if rule is well-defined
}

exports.handleRoiCascade = async (payload, session, event) => {
    const { userId, lpRoiAmount, processingDate, originalUserLevel, triggeringEventId } = payload;
    console.log(`ROI_CASCADE Handler: Processing for user ${userId}, Original LP ROI Amount for cascade: ${lpRoiAmount}`);

    const originalRoiD128 = Decimal128.fromString(lpRoiAmount.toString());

    const roiEarner = await User.findById(userId).select('path sponsorId username').lean().session(session);
    if (!roiEarner) {
        throw new Error(`ROI earner user ${userId} not found for cascade.`);
    }

    // Path is stored [root, grandParent, parent]. We need to iterate from parent upwards.
    const uplinePath = [...(roiEarner.path || [])]; // Create a mutable copy
    if (roiEarner.sponsorId && (uplinePath.length === 0 || uplinePath[uplinePath.length -1].toString() !== roiEarner.sponsorId.toString())) {
      // This case implies path might be missing direct sponsor, adding it. Path should ideally be always correct.
      // Or if user has sponsorId but empty path (direct child of a conceptual root not in path)
      console.warn(`User ${userId} has sponsorId ${roiEarner.sponsorId} but path might be incomplete or not ending with it. Adding sponsorId to path for cascade.`);
      if (!uplinePath.find(pId => pId.toString() === roiEarner.sponsorId.toString())) {
         uplinePath.push(roiEarner.sponsorId); 
      }
    }

    let qualifiedAncestorsProcessed = 0;

    for (let i = uplinePath.length - 1; i >= 0; i--) {
        if (qualifiedAncestorsProcessed >= 16) {
            console.log(`ROI_CASCADE: Reached max 16 qualified ancestors for user ${roiEarner.username || userId}. Stopping cascade.`);
            break;
        }

        const sponsorUserId = uplinePath[i];
        const distance = uplinePath.length - 1 - i + 1; // Distance from original earner (1 = direct sponsor)

        if (distance > 16) {
            console.log(`ROI_CASCADE: Sponsor ${sponsorUserId} is at distance ${distance} for user ${roiEarner.username || userId}, exceeding max 16 levels. Stopping for this path segment.`);
            break; 
        }

        const rule = cascadeUnlockRules.find(r => r.level === distance);
        if (!rule) {
            console.log(`ROI_CASCADE: No rule found for distance ${distance} for sponsor ${sponsorUserId}. Skipping.`);
            continue;
        }

        const sponsor = await User.findById(sponsorUserId).select('username counters level').session(session);
        if (!sponsor) {
            console.warn(`ROI_CASCADE: Sponsor user ${sponsorUserId} at distance ${distance} for user ${roiEarner.username || userId} not found. Skipping.`);
            continue;
        }

        // Check unlock conditions
        const isUnlocked = checkSponsorUnlock(sponsor.counters, rule);

        if (isUnlocked) {
            const cascadeBonusPct = Decimal128.fromString(rule.pct.toString());
            let cascadeAmountD128 = originalRoiD128.multiply(cascadeBonusPct);

            if (cascadeAmountD128.toFloat() <= 0) {
                console.log(`ROI_CASCADE: Sponsor ${sponsor.username || sponsorUserId} (Level ${distance} above ${roiEarner.username || userId}) initial cascade amount is ${cascadeAmountD128.toString()}. Skipping.`);
                continue;
            }

            const sponsorLedger = await getOrCreateLedger(sponsorUserId, session);
            const fiveXLimitDef = sponsorLedger.limits.fiveXLimit;
            const remainingFiveXRoom = fiveXLimitDef.cap.subtract(fiveXLimitDef.used);
            let fiveXAppliedDescription = 'WithinFiveX';

            if (remainingFiveXRoom.toFloat() <= 0) {
                console.log(`ROI_CASCADE: Sponsor ${sponsor.username || sponsorUserId} FiveXLimit already exhausted. Cap: ${fiveXLimitDef.cap}, Used: ${fiveXLimitDef.used}. Cannot credit cascade bonus.`);
                continue; 
            }

            if (cascadeAmountD128.compare(remainingFiveXRoom) === 1) { // cascadeAmount > remainingFiveXRoom
                cascadeAmountD128 = remainingFiveXRoom;
                fiveXAppliedDescription = 'FIVEX_CAP';
            }
            
            if (cascadeAmountD128.toFloat() <= 0) { // Check again after FiveX cap
                console.log(`ROI_CASCADE: Sponsor ${sponsor.username || sponsorUserId} cascade amount is ${cascadeAmountD128.toString()} after FiveX adjustment. Skipping.`);
                continue;
            }

            qualifiedAncestorsProcessed++; // Count only if an amount is actually paid
            sponsorLedger.wallets.communityRewards = sponsorLedger.wallets.communityRewards.add(cascadeAmountD128);
            sponsorLedger.limits.fiveXLimit.used = sponsorLedger.limits.fiveXLimit.used.add(cascadeAmountD128);
            
            await createLedgerEntry({
                userId: sponsorUserId,
                eventType: 'ROI_CASCADE',
                amount: cascadeAmountD128.toString(),
                walletFrom: 'USER_LP_ROI', // Signifying source is another user's LP ROI
                walletTo: 'COMMUNITY_REWARDS',
                narrative: `Cascade ROI (${rule.pct * 100}%) from user ${roiEarner.username || userId} (Level ${distance} below). Original LP ROI: ${originalRoiD128.toString()}. FiveX Applied: ${fiveXAppliedDescription}`,
                refId: triggeringEventId, // Ref to the DAILY_ROI_USER event or the ROI_CASCADE event that triggered this specific payout
                ratePct: rule.pct.toString()
            }, session);

            await sponsorLedger.save({ session });
            console.log(`ROI_CASCADE: Sponsor ${sponsor.username || sponsorUserId} (Level ${distance} above ${roiEarner.username || userId}) received ${cascadeAmountD128.toString()} into Community Rewards. FiveX: ${fiveXAppliedDescription}.`);

        } else {
            console.log(`ROI_CASCADE: Sponsor ${sponsor.username || sponsorUserId} (Level ${distance} above ${roiEarner.username || userId}) did not meet unlock criteria for ${rule.pct*100}% cascade.`);
        }
    }
    console.log(`ROI_CASCADE for LP ROI from user ${roiEarner.username || userId} processed. ${qualifiedAncestorsProcessed} upline sponsors paid.`);
}; 