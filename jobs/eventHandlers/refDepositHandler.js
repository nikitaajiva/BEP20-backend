const mongoose = require('mongoose');
const User = require('../../models/User');
// const Ledger = require('../../models/Ledger');
// const LedgerRow = require('../../models/LedgerRow');
const { Decimal128 } = mongoose.Types;
const { createLedgerEntry, getOrCreateLedger } = require('../helpers/ledgerHelpers');
const { addDecimal128, subtractDecimal128, compareDecimal128, minDecimal128 } = require('../../utils/decimal128Utils');

exports.handleRefDeposit = async (payload, session, event) => {
    // ... (rest of the function remains the same, local helper functions are removed)
    const {
        referralUserId,
        sponsorUserId,
        depositAmount,
        originalDepositTimestamp,
        depositTxHash,
        lpDepositEventId
    } = payload;

    console.log(`REF_DEPOSIT Handler: Processing for sponsor ${sponsorUserId} due to deposit by referral ${referralUserId}`);

    const sponsor = await User.findById(sponsorUserId).session(session);
    if (!sponsor) {
        throw new Error(`Sponsor user ${sponsorUserId} not found.`);
    }

    const referral = await User.findById(referralUserId).session(session);
    if (!referral) {
        throw new Error(`Referral user ${referralUserId} not found. This might indicate an issue.`);
    }

    const sponsorLedger = await getOrCreateLedger(sponsorUserId, session); // Uses helper

    const depositAmountD128 = Decimal128.fromString(depositAmount.toString());
    const referralRegistrationTs = referral.registrationTs;
    const depositTs = new Date(originalDepositTimestamp);

    const timeSinceReferralRegistrationMs = depositTs.getTime() - referralRegistrationTs.getTime();
    const hoursSinceReferralRegistration = timeSinceReferralRegistrationMs / (1000 * 60 * 60);

    let bonusPercentage = 0;
    if (hoursSinceReferralRegistration <= 48) {
        bonusPercentage = 0.50;
    } else if (hoursSinceReferralRegistration <= 216) {
        bonusPercentage = 0.30;
    } else if (hoursSinceReferralRegistration <= 384) {
        bonusPercentage = 0.20;
    } else if (hoursSinceReferralRegistration <= 552) {
        bonusPercentage = 0.10;
    } else {
        bonusPercentage = 0;
    }

    console.log(`Sponsor ${sponsorUserId}: Referral ${referralUserId} deposited. Hours since ref registration: ${hoursSinceReferralRegistration.toFixed(2)}. Bonus: ${bonusPercentage * 100}%`);

    if (bonusPercentage > 0) {
        const bonusAmountD128 = depositAmountD128.multiply(Decimal128.fromString(bonusPercentage.toString()));

        const boostWalletBalance = sponsorLedger.wallets.boost instanceof Decimal128
            ? sponsorLedger.wallets.boost
            : Decimal128.fromString(sponsorLedger.wallets.boost ? sponsorLedger.wallets.boost.toString() : '0.0');

        const boostLimitCap = sponsorLedger.limits.boostLimit.cap instanceof Decimal128
            ? sponsorLedger.limits.boostLimit.cap
            : Decimal128.fromString(sponsorLedger.limits.boostLimit.cap ? sponsorLedger.limits.boostLimit.cap.toString() : '0.0');

        const availableBoostCapacity = subtractDecimal128(boostLimitCap, boostWalletBalance);
        
        console.log(`[BOOST_BONUS_CHECK] Sponsor: ${sponsorUserId}, Boost Balance: ${boostWalletBalance.toString()}, Boost Limit: ${boostLimitCap.toString()}, Available Capacity: ${availableBoostCapacity.toString()}`);

        if (compareDecimal128(availableBoostCapacity, '0.0') <= 0) {
            console.log(`[BOOST_BONUS_CHECK] Sponsor: ${sponsorUserId} has no available capacity in boost wallet. Skipping boost bonus.`);
        } else {
            const actualBonusToCredit = minDecimal128(bonusAmountD128, availableBoostCapacity);

            console.log(`[BOOST_BONUS_CHECK] Sponsor: ${sponsorUserId}, Calculated Bonus: ${bonusAmountD128.toString()}, Actual Bonus to Credit: ${actualBonusToCredit.toString()}`);

            if (compareDecimal128(actualBonusToCredit, '0.0') > 0) {
                sponsorLedger.wallets.boost = addDecimal128(boostWalletBalance, actualBonusToCredit);
                console.log(`Sponsor ${sponsorUserId} boost wallet updated to: ${sponsorLedger.wallets.boost.toString()}. Bonus credited: ${actualBonusToCredit.toString()}`);

                await createLedgerEntry({ // Uses helper
                    userId: sponsorUserId,
                    eventType: 'BOOST_BONUS',
                    amount: actualBonusToCredit.toString(),
                    walletFrom: 'SYSTEM',
                    walletTo: 'BOOST',
                    narrative: `Boost bonus from referral ${referral.username || referralUserId} deposit of ${depositAmountD128.toString()} (${bonusPercentage * 100}%)`,
                    refId: lpDepositEventId,
                    ratePct: bonusPercentage.toString()
                }, session);

                await sponsorLedger.save({ session });
            }
        }
    } else {
        console.log(`Sponsor ${sponsorUserId} not eligible for boost bonus from referral ${referralUserId} deposit (time expired or 0%).`);
    }

    console.log(`REF_DEPOSIT for sponsor ${sponsorUserId} processed successfully.`);
};