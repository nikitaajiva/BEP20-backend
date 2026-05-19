const mongoose = require('mongoose');
const User = require('../../models/User');
const Outbox = require('../../models/Outbox');
const { Decimal128 } = mongoose.Types;
const { createLedgerEntry, getOrCreateLedger } = require('../helpers/ledgerHelpers');
const {
    addDecimal128,
    subtractDecimal128,
    multiplyDecimal128,
    compareDecimal128,
    convertToFloat
} = require('../../utils/decimal128Utils');

const { getRoiSlabInfo } = require('../../utils/constants');

function getRoiRateForBalance(balanceD128) {
    const balance = convertToFloat(balanceD128);
    const slabInfo = getRoiSlabInfo(balance);
    
    if (!slabInfo) {
        return { rate: 0, description: 'No applicable slab' };
    }
    
    return { 
        rate: slabInfo.rate, 
        description: `>=${slabInfo.minBalance}:${slabInfo.rate*100}%` 
    };
}

exports.handleDailyRoiUser = async (payload, session, event) => {
    const { userId, processingDate } = payload;
    

    const user = await User.findById(userId).session(session);
    if (!user) {
        throw new Error(`User ${userId} not found for ROI calculation.`);
    }

    const ledger = await getOrCreateLedger(userId, session);
    let totalLpRoiEarned = Decimal128.fromString('0.0');

    const walletsToProcess = [
        { name: 'LP', limitKey: null, balance: ledger.wallets.lp },
        { name: 'Swift', limitKey: 'swiftLimit', balance: ledger.wallets.swift },
        { name: 'Boost', limitKey: 'boostLimit', balance: ledger.wallets.boost },
        { name: 'Airdrop', limitKey: 'airdropLimit', balance: ledger.wallets.airdrop },
    ];

    for (const wallet of walletsToProcess) {
        if (!wallet.balance || convertToFloat(wallet.balance) <= 0) {
            
            continue;
        }

        const { rate, description: rateSlabDescription } = getRoiRateForBalance(wallet.balance);
        if (rate === 0) {
            
            continue;
        }

        let calculatedRoi = multiplyDecimal128(wallet.balance, Decimal128.fromString(rate.toString()));
        let roiToCredit = calculatedRoi;
        let walletLimitAppliedDescription = 'None';

        // 1. Apply individual wallet limits (SwiftLimit, BoostLimit)
        if (wallet.limitKey) {
            const limitDef = ledger.limits[wallet.limitKey];
            const remainingWalletLimit = subtractDecimal128(limitDef.cap, limitDef.used);
            
            if (convertToFloat(remainingWalletLimit) <= 0) {
                
                continue; 
            }
            if (compareDecimal128(roiToCredit, remainingWalletLimit) === 1) { // roiToCredit > remainingWalletLimit
                roiToCredit = remainingWalletLimit;
                walletLimitAppliedDescription = `${wallet.limitKey.replace('Limit', '').toUpperCase()}_CAP`;
            } else {
                walletLimitAppliedDescription = 'RateBasis';
            }
        }

        if (convertToFloat(roiToCredit) <= 0) {
            
            continue;
        }

        // 2. Apply FiveXLimit (overall earnings cap for Community-Rewards)
        const fiveXLimitDef = ledger.limits.fiveXLimit;
        const remainingFiveXRoom = subtractDecimal128(fiveXLimitDef.cap, fiveXLimitDef.used);

        if (convertToFloat(remainingFiveXRoom) <= 0) {
            
            continue; // Cannot credit any more to Community Rewards
        }

        let finalRoiCreditedToCommunity = roiToCredit;
        let fiveXAppliedDescription = 'None';

        if (compareDecimal128(roiToCredit, remainingFiveXRoom) === 1) { // roiToCredit > remainingFiveXRoom
            finalRoiCreditedToCommunity = remainingFiveXRoom;
            fiveXAppliedDescription = 'FIVEX_CAP';
        } else {
            fiveXAppliedDescription = 'WithinFiveX';
        }

        if (convertToFloat(finalRoiCreditedToCommunity) <= 0) {
            
            continue;
        }

        // Add finalRoiCreditedToCommunity to Community-Rewards wallet
        ledger.wallets.communityRewards = addDecimal128(ledger.wallets.communityRewards, finalRoiCreditedToCommunity);

        // Increase pending for the respective individual wallet limit (Swift/Boost)
        if (wallet.limitKey) {
            ledger.limits[wallet.limitKey].used = addDecimal128(ledger.limits[wallet.limitKey].used, finalRoiCreditedToCommunity);
        }

        // Increase pending for FiveXLimit
        ledger.limits.fiveXLimit.used = addDecimal128(ledger.limits.fiveXLimit.used, finalRoiCreditedToCommunity);
        // Decrease the zero risk wallet limit
        ledger.limits.zeroRiskLimit.used = addDecimal128(ledger.limits.zeroRiskLimit.used, finalRoiCreditedToCommunity);
        ledger.totalRewardsCredited = addDecimal128(ledger.totalRewardsCredited, finalRoiCreditedToCommunity);

        const narrative = `Daily ROI credit from ${wallet.name} wallet. Rate: ${rate*100}%. Original: ${calculatedRoi.toString()}, Capped: ${finalRoiCreditedToCommunity.toString()}. WalletLimit: ${walletLimitAppliedDescription}, FiveXLimit: ${fiveXAppliedDescription}.`;

        // Create LedgerRow
        await createLedgerEntry({
            userId,
            eventType: 'ROI_CREDIT',
            amount: finalRoiCreditedToCommunity.toString(),
            walletFrom: wallet.name.toUpperCase(),
            walletTo: 'COMMUNITY_REWARDS',
            narrative: narrative,
            refId: event._id.toString(), 
            ratePct: rate.toString(),
            roiDetails: {
                walletSource: wallet.name.toUpperCase(),
                rateSlab: rateSlabDescription,
                limitApplied: `${walletLimitAppliedDescription}, ${fiveXAppliedDescription}` // Combined description
            }
        }, session);

        

        if (wallet.name === 'LP') {
            totalLpRoiEarned = addDecimal128(totalLpRoiEarned, finalRoiCreditedToCommunity); // totalLpRoiEarned is what actually hit CommunityRewards
        }
    }

    await ledger.save({ session });

    // If LP-ROI > 0, emit ROI_CASCADE
    if (convertToFloat(totalLpRoiEarned) > 0) {
        
        const cascadePayload = {
            userId, 
            lpRoiAmount: totalLpRoiEarned.toString(), // This is the amount that actually hit CommunityRewards and is eligible for cascade
            processingDate,
            originalUserLevel: user.level, 
            triggeringEventId: event._id.toString()
        };
        const cascadeEvent = new Outbox({
            eventType: 'ROI_CASCADE',
            payload: cascadePayload,
            status: 'PENDING',
            nextRunTs: new Date()
        });
        await cascadeEvent.save({ session }); 
    }

    
}; 
