const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');

// Import models
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const AirdropReward = require('../../models/AirdropReward');
const BoostReward = require('../../models/BoostReward');
const LpReward = require('../../models/LpReward');
const connectDB = require("../../config/db")

// --- Helper Functions ---
const toFloat = (decimal) => parseFloat(decimal.toString());
const fromFloat = (float) => Decimal128.fromString(float.toString());

// --- CONFIGURATION ---
const REWARD_THRESHOLD = 5000;
const REWARD_RATE_HIGH = '0.006'; // 0.6%
const REWARD_RATE_LOW = '0.005';  // 0.5%
const FIVE_X_MULTIPLIER = 5;

const distributeRewards = async () => {
    await connectDB();
    

    const ledgers = await Ledger.find({ 'wallets.lp': { $gt: new Decimal128('0') } });
    

    for (const ledger of ledgers) {
        try {
            

            // --- 1. Update Limit Caps ---
            const lpBalance = toFloat(ledger.wallets.lp);
            const airdropBalance = toFloat(ledger.wallets.airdrop);
            const boostBalance = toFloat(ledger.wallets.boost);

            ledger.limits.lpLimit.cap = fromFloat(lpBalance * 2);
            ledger.limits.airdropLimit.cap = fromFloat(airdropBalance);
          //  ledger.limits.boostLimit.cap = fromFloat(boostBalance);
            
            // --- 2. Calculate Potential Rewards ---
            const getRate = (balance) => balance >= REWARD_THRESHOLD ? REWARD_RATE_HIGH : REWARD_RATE_LOW;
            
            const lpRate = getRate(lpBalance);
            const airdropRate = getRate(airdropBalance);
            const boostRate = getRate(boostBalance);

            let potentialLpReward = lpBalance * parseFloat(lpRate);
            let potentialAirdropReward = airdropBalance * parseFloat(airdropRate);
            let potentialBoostReward = boostBalance * parseFloat(boostRate);
            
            // --- 3. Cap Rewards by Individual Limits ---
            const capReward = (reward, limit) => Math.max(0, Math.min(reward, toFloat(limit.cap) - toFloat(limit.used)));

            let cappedLpReward = capReward(potentialLpReward, ledger.limits.lpLimit);
            let cappedAirdropReward = capReward(potentialAirdropReward, ledger.limits.airdropLimit);
            let cappedBoostReward = capReward(potentialBoostReward, ledger.limits.boostLimit);
            
            let totalCappedReward = cappedLpReward + cappedAirdropReward + cappedBoostReward;

            // --- 4. Apply Global 5X LP Cap ---
            const fiveXLimitUsed = toFloat(ledger.limits.fiveXLimit.used);
            const maxFiveXBenefit = Math.max(0, (lpBalance * FIVE_X_MULTIPLIER) - fiveXLimitUsed);
            
            let finalTotalReward = Math.min(totalCappedReward, maxFiveXBenefit);
            
            // If the 5X limit reduced the total reward, scale down individual rewards proportionally
            if (finalTotalReward < totalCappedReward && totalCappedReward > 0) {
                const reductionFactor = finalTotalReward / totalCappedReward;
                cappedLpReward *= reductionFactor;
                cappedAirdropReward *= reductionFactor;
                cappedBoostReward *= reductionFactor;
                
            }

            if (finalTotalReward <= 0) {
                
                await ledger.save(); // Save the updated caps even if no reward
                continue;
            }

            // --- 5. Update Balances and Limits ---
            const zeroRiskDebit = Math.min(toFloat(ledger.wallets.zeroRisk), finalTotalReward);

            ledger.wallets.communityRewards = fromFloat(toFloat(ledger.wallets.communityRewards) + finalTotalReward);
            ledger.totalRewardsCredited = fromFloat(toFloat(ledger.totalRewardsCredited) + finalTotalReward);
           // ledger.wallets.zeroRisk = fromFloat(toFloat(ledger.wallets.zeroRisk) - zeroRiskDebit);

            ledger.limits.lpLimit.used = fromFloat(toFloat(ledger.limits.lpLimit.used) + cappedLpReward);
            ledger.limits.airdropLimit.used = fromFloat(toFloat(ledger.limits.airdropLimit.used) + cappedAirdropReward);
            ledger.limits.boostLimit.used = fromFloat(toFloat(ledger.limits.boostLimit.used) + cappedBoostReward);
            ledger.limits.fiveXLimit.used = fromFloat(fiveXLimitUsed + finalTotalReward);

            await ledger.save();
            

            // --- 6. Create Transaction History ---
            const ledgerRows = [];
            const utcDate = new Date().toUTCString();

            if (cappedLpReward > 0) {
                const narrative = `Balance: ${lpBalance.toFixed(4)}, Reward: ${cappedLpReward.toFixed(4)} @ ${parseFloat(lpRate) * 100}% on ${utcDate}`;
                await LpReward.create({ userId: ledger.userId, amount: fromFloat(cappedLpReward), rate: fromFloat(lpRate), narrative });
                ledgerRows.push({ userId: ledger.userId, eventType: 'DAILY_REWARDS_LP', walletTo: 'COMMUNITY_REWARDS', amount: fromFloat(cappedLpReward), narrative: `Daily LP Reward @ ${parseFloat(lpRate) * 100}%` });
            }
            if (cappedAirdropReward > 0) {
                const narrative = `Balance: ${airdropBalance.toFixed(4)}, Reward: ${cappedAirdropReward.toFixed(4)} @ ${parseFloat(airdropRate) * 100}% on ${utcDate}`;
                await AirdropReward.create({ userId: ledger.userId, amount: fromFloat(cappedAirdropReward), rate: fromFloat(airdropRate), narrative });
                ledgerRows.push({ userId: ledger.userId, eventType: 'DAILY_REWARDS_AIRDROP', walletTo: 'COMMUNITY_REWARDS', amount: fromFloat(cappedAirdropReward), narrative: `Daily Airdrop Reward @ ${parseFloat(airdropRate) * 100}%` });
            }
            if (cappedBoostReward > 0) {
                const narrative = `Balance: ${boostBalance.toFixed(4)}, Reward: ${cappedBoostReward.toFixed(4)} @ ${parseFloat(boostRate) * 100}% on ${utcDate}`;
                await BoostReward.create({ userId: ledger.userId, amount: fromFloat(cappedBoostReward), rate: fromFloat(boostRate), narrative });
                ledgerRows.push({ userId: ledger.userId, eventType: 'DAILY_REWARDS_BOOST', walletTo: 'COMMUNITY_REWARDS', amount: fromFloat(cappedBoostReward), narrative: `Daily Boost Reward @ ${parseFloat(boostRate) * 100}%` });
            }

            if (ledgerRows.length > 0) {
                await LedgerRow.insertMany(ledgerRows);
                
            }

        } catch (error) {
            console.error(`Failed to process rewards for user ${ledger.uhid}:`, error);
        }
    }

    
    await mongoose.disconnect();
};

distributeRewards();
