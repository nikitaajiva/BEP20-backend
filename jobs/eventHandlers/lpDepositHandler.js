const mongoose = require('mongoose');
const User = require('../../models/User');
const Outbox = require('../../models/Outbox');
const { Decimal128 } = mongoose.Types;
const { createLedgerEntry, getOrCreateLedger } = require('../helpers/ledgerHelpers');
const { addDecimal128, subtractDecimal128 } = require('../../utils/decimal128Utils');
const airdropPromotionConfig = require('../../config/airdropPromotionConfig');

async function updateUplineTeamLp(user, amountD128, session) {
    // The user's path is an array of IDs from the root to the user.
    // e.g., [root, level1, level2 (sponsor), level3 (self)]
    // We reverse the upline to start from the direct sponsor.
    const uplineIds = user.path.slice(0, -1).reverse();

    for (let i = 0; i < uplineIds.length; i++) {
        const level = i + 1; // 1 = direct sponsor, 2 = sponsor's sponsor, etc.
        if (level > 16) break; // No need to process further than 16 levels up.

        const sponsorId = uplineIds[i];
        const sponsor = await User.findById(sponsorId).session(session);
        if (!sponsor) {
            console.error(`Could not find sponsor with ID: ${sponsorId} during upline LP update.`);
            continue; 
        }

        let updated = false;
        // Update counters based on level
        if (level <= 3) {
            sponsor.counters.teamLpFirst3Lvls = addDecimal128(sponsor.counters.teamLpFirst3Lvls || '0.0', amountD128);
            updated = true;
        }
        if (level <= 5) {
            sponsor.counters.teamLpFirst5Lvls = addDecimal128(sponsor.counters.teamLpFirst5Lvls || '0.0', amountD128);
            updated = true;
        }
        if (level <= 16) {
            sponsor.counters.teamLpFirst16Lvls = addDecimal128(sponsor.counters.teamLpFirst16Lvls || '0.0', amountD128);
            updated = true;
        }
        
        if (updated) {
            await sponsor.save({ session });
            console.log(`Updated teamLp counters for sponsor ${sponsor.username} (level ${level} upline) by ${amountD128.toString()}`);
        }
    }
}

function getAirdropBonusPercentage(depositTimestamp) {
    const { startTimestamp, steps } = airdropPromotionConfig;
    const depositTime = new Date(depositTimestamp).getTime();
    
    if (depositTime < startTimestamp) {
        return 0; // Promotion hasn't started
    }

    const hoursSinceStart = (depositTime - startTimestamp) / (1000 * 60 * 60);
    
    let cumulativeHours = 0;
    for (const step of steps) {
        cumulativeHours += step.durationHours;
        if (hoursSinceStart < cumulativeHours) {
            return step.percentage;
        }
    }

    return 0; // Promotion period has ended
}

exports.handleLpDeposit = async (payload, session, event) => {
    const { userId, amount, txHash, depositTimestamp } = payload;
    console.log(`LP_DEPOSIT Handler: Processing for user ${userId}, amount ${amount}`);

    const user = await User.findById(userId).session(session);
    if (!user) {
        throw new Error(`User ${userId} not found.`);
    }

    const ledger = await getOrCreateLedger(userId, session);
    const depositAmountD128 = Decimal128.fromString(amount.toString());

    // Enforce a minimum deposit amount of 9 USDT.
    const minimumLpDeposit = Decimal128.fromString("9.0");
    if (depositAmountD128.toFloat() < minimumLpDeposit.toFloat()) {
        const errorMessage = `LP Deposit amount of ${amount} USDT is less than the minimum required 9 USDT.`;
        console.error(`Validation failed for user ${userId}: ${errorMessage}`);
        // Throwing an error will halt processing and rely on the transaction to be rolled back.
        throw new Error(errorMessage);
    }

    // Ensure selfLp counter is a Decimal128 before we check it
    if (!(user.counters.selfLp instanceof Decimal128)) {
        user.counters.selfLp = Decimal128.fromString(user.counters.selfLp ? user.counters.selfLp.toString() : '0.0');
    }

    // Check if this is the user's first LP deposit.
    // We check user.counters.selfLp because it only ever increases, unlike limit caps
    // which can be decreased by withdrawals. This prevents limits from being reset.
    const isFirstDeposit = user.counters.selfLp.toString() === '0.0';
    console.log(`User ${userId} isFirstDeposit: ${isFirstDeposit}, current selfLp total: ${user.counters.selfLp.toString()}`);

    if (isFirstDeposit) {
        user.firstLpDepositTs = new Date(depositTimestamp);
        console.log(`Set firstLpDepositTs for user ${userId} to ${user.firstLpDepositTs}`);
    }

    // --- New Time-Sensitive Sponsor Boost Bonus Logic ---
    if (user.sponsorId) {
        const sponsor = await User.findById(user.sponsorId).session(session);
        if (sponsor && sponsor.firstLpDepositTs) {
            const sponsorFirstLpTime = new Date(sponsor.firstLpDepositTs).getTime();
            const currentUserDepositTime = new Date(depositTimestamp).getTime();
            const hoursDifference = (currentUserDepositTime - sponsorFirstLpTime) / (1000 * 60 * 60);

            let bonusPercentage = 0;
            if (hoursDifference <= 48) {
                bonusPercentage = 0.50; // 50%
            } else if (hoursDifference <= 48 + 168) {
                bonusPercentage = 0.30; // 30%
            } else if (hoursDifference <= 48 + (168 * 2)) {
                bonusPercentage = 0.20; // 20%
            } else if (hoursDifference <= 48 + (168 * 3)) {
                bonusPercentage = 0.10; // 10%
            } else if (hoursDifference <= 48 + (168 * 4)) {
                bonusPercentage = 0.05; // 5%
            }

            if (bonusPercentage > 0) {
                const bonusAmount = depositAmountD128.multiply(Decimal128.fromString(bonusPercentage.toString()));
                const sponsorLedger = await getOrCreateLedger(sponsor._id, session);
                sponsorLedger.wallets.boost = addDecimal128(sponsorLedger.wallets.boost, bonusAmount);
                await sponsorLedger.save({ session });

                await createLedgerEntry({
                    userId: sponsor._id,
                    eventType: 'BOOST_BONUS',
                    amount: bonusAmount.toString(),
                    walletFrom: 'SYSTEM',
                    walletTo: 'BOOST',
                    narrative: `Boost bonus (${bonusPercentage * 100}%) from direct referral ${user.username}'s deposit.`,
                    refId: user._id.toString() // Reference the user who made the deposit
                }, session);

                console.log(`Credited ${bonusAmount.toString()} to sponsor ${sponsor.username}'s Boost wallet.`);
            }
        }
    }
    // --- End Sponsor Boost Bonus Logic ---

    // This block is for the old, time-since-registration airdrop.
    // It is separate from the new sponsor boost bonus.
    if (isFirstDeposit) {
        console.log(`Processing first-time deposit bonuses for ${depositAmountD128.toString()} USDT`);
        
        const timeSinceRegistrationMs = new Date(depositTimestamp).getTime() - user.registrationTs.getTime();
        const hoursSinceRegistration = timeSinceRegistrationMs / (1000 * 60 * 60);

        let matchedPercentage = 0;
        if (hoursSinceRegistration <= 48) matchedPercentage = 1.0;
        else if (hoursSinceRegistration <= 5 * 24) matchedPercentage = 0.8;
        else if (hoursSinceRegistration <= 8 * 24) matchedPercentage = 0.6;
        else if (hoursSinceRegistration <= 11 * 24) matchedPercentage = 0.4;
        else if (hoursSinceRegistration <= 14 * 24) matchedPercentage = 0.2;

        const companyAirdropAvailable = Decimal128.fromString("100.0");
        const maxAirdropFromDepositPercentage = depositAmountD128.multiply(Decimal128.fromString(matchedPercentage.toString()));
        const actualMatchedAirdrop = Decimal128.min(companyAirdropAvailable, maxAirdropFromDepositPercentage);

        if (actualMatchedAirdrop.toFloat() > 0) {
            console.log(`Airdrop activation for user ${userId}: ${actualMatchedAirdrop.toString()} USDT matched.`);
            // This is the initial airdrop for first deposit, should go to airdrop wallet not LP
            ledger.wallets.airdrop = addDecimal128(ledger.wallets.airdrop, actualMatchedAirdrop);
            
            await createLedgerEntry({
                userId,
                eventType: 'AIRDROP_ACTIVATION',
                amount: actualMatchedAirdrop.toString(),
                walletFrom: 'SYSTEM', // Airdrops come from the system
                walletTo: 'AIRDROP',
                narrative: `Airdrop matched from first deposit (${matchedPercentage*100}%)`,
                refId: event._id.toString()
            }, session);
        } else {
            console.log(`No airdrop matched for user ${userId}. Matched percentage: ${matchedPercentage}, Hours: ${hoursSinceRegistration}`);
        }
    }

    // --- Update limits on EVERY deposit ---
    ledger.limits.airdropLimit.cap = addDecimal128(ledger.limits.airdropLimit.cap, depositAmountD128);
    ledger.limits.boostLimit.cap = addDecimal128(ledger.limits.boostLimit.cap, depositAmountD128);
    ledger.limits.fiveXLimit.cap = addDecimal128(ledger.limits.fiveXLimit.cap, depositAmountD128.multiply(Decimal128.fromString("5.0")));
    // Credit principal directly to Zero-Risk wallet (limits.zeroRiskLimit deprecated)
    ledger.wallets.zeroRisk = addDecimal128(ledger.wallets.zeroRisk, depositAmountD128);
    console.log(`Limits updated for user ${userId}:
        Airdrop: ${ledger.limits.airdropLimit.cap.toString()}
        Boost: ${ledger.limits.boostLimit.cap.toString()}
        FiveX: ${ledger.limits.fiveXLimit.cap.toString()}
        ZeroRisk: ${ledger.wallets.zeroRisk.toString()}`);

    // --- New Airdrop Promotion Logic ---
    const bonusPercentage = getAirdropBonusPercentage(depositTimestamp);
    if (bonusPercentage > 0) {
        const bonusAmountD128 = depositAmountD128.multiply(Decimal128.fromString(bonusPercentage.toString()));
        console.log(`Airdrop promotion: User ${userId} qualifies for a ${bonusPercentage * 100}% bonus of ${bonusAmountD128.toString()} USDT.`);

        const swiftBalance = ledger.wallets.swift;
        if (swiftBalance.toFloat() >= bonusAmountD128.toFloat()) {
            ledger.wallets.swift = subtractDecimal128(swiftBalance, bonusAmountD128);
            ledger.wallets.airdrop = addDecimal128(ledger.wallets.airdrop, bonusAmountD128);

            await createLedgerEntry({
                userId,
                eventType: 'PROMOTION_BONUS',
                amount: bonusAmountD128.toString(),
                walletFrom: 'SWIFT',
                walletTo: 'AIRDROP',
                narrative: `Airdrop promotion bonus (${bonusPercentage * 100}%) on LP deposit.`,
                refId: event._id.toString()
            }, session);

            console.log(`Transferred ${bonusAmountD128.toString()} from Swift to Airdrop wallet for user ${userId}.`);
            console.log(`New Swift balance: ${ledger.wallets.swift.toString()}, New Airdrop balance: ${ledger.wallets.airdrop.toString()}`);
        } else {
            console.log(`User ${userId} has insufficient Swift balance (${swiftBalance.toString()}) to cover airdrop bonus of ${bonusAmountD128.toString()}.`);
        }
    }
    // --- End New Airdrop Promotion Logic ---

    // Update LP wallet balance and current LP for all deposits
    ledger.wallets.lp = addDecimal128(ledger.wallets.lp, depositAmountD128);
    ledger.currentLp = addDecimal128(ledger.currentLp, depositAmountD128);
    console.log(`User ${userId} LP wallet updated to: ${ledger.wallets.lp.toString()}, Current LP: ${ledger.currentLp.toString()}`);

    await createLedgerEntry({
        userId,
        eventType: 'DEPOSIT',
        amount: depositAmountD128.toString(),
        walletFrom: 'EXTERNAL',
        walletTo: 'LP',
        narrative: `User LP deposit. TxHash: ${txHash}`,
        refId: txHash
    }, session);

    user.counters.selfLp = addDecimal128(user.counters.selfLp, depositAmountD128);
    console.log(`User ${userId} selfLp counter updated to: ${user.counters.selfLp.toString()}`);

    // Update team LP for upline
    if (user.sponsorId) {
        await updateUplineTeamLp(user, depositAmountD128, session);
    }

    if (user.sponsorId) {
        console.log(`User ${userId} has sponsor ${user.sponsorId}. Emitting REF_DEPOSIT event.`);
        const refDepositPayload = {
            referralUserId: userId,
            sponsorUserId: user.sponsorId,
            depositAmount: depositAmountD128.toString(),
            originalDepositTimestamp: depositTimestamp,
            depositTxHash: txHash,
            lpDepositEventId: event._id
        };
        const sponsorEvent = new Outbox({
            eventType: 'REF_DEPOSIT',
            payload: refDepositPayload,
            status: 'PENDING',
            nextRunTs: new Date()
        });
        await sponsorEvent.save({ session });
        console.log(`REF_DEPOSIT event for sponsor ${user.sponsorId} enqueued.`);
    }

    await user.save({ session });
    await ledger.save({ session });

    console.log(`LP_DEPOSIT for user ${userId} processed successfully.`);
}; 