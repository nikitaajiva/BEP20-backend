const mongoose = require('mongoose');
const path = require('path');
// Configure dotenv to read from the backend directory's .env file
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const Level = require('../../models/Level');
const DailyRewardLog = require('../../models/DailyRewardLog');
const { addDecimal128, multiplyDecimal128, convertToFloat } = require('../../utils/decimal128Utils');

// Qualification rules for the Level Booster Bonus
const QUALIFICATION_LEVELS = [
    { level: 1, teamVolume: 10000, directVolume: 2000, bonusRate: 0.12 },
    { level: 2, teamVolume: 20000, directVolume: 6000, bonusRate: 0.10 },
    { level: 3, teamVolume: 30000, directVolume: 12000, bonusRate: 0.07 },
];

/**
 * Connects to the MongoDB database.
 */
const connectDB = async () => {
    try {
        const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/xrpmigrate';
        if (!dbURI) {
            throw new Error('MONGODB_URI is not defined in the .env file.');
        }
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

/**
 * Retrieves or creates a ledger for a given user.
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @returns {Promise<mongoose.Document>} The user's ledger document.
 */
const getOrCreateLedger = async (userId) => {
    let ledger = await Ledger.findOne({ userId });
    if (!ledger) {
        const user = await User.findById(userId).select('uhid').lean();
        if (!user) throw new Error(`User not found for ledger creation: ${userId}`);
        ledger = new Ledger({ userId, uhid: user.uhid });
        await ledger.save();
        
    }
    return ledger;
};

/**
 * Calculates the total LP volume for a user's team within a specified number of levels.
 * @param {string} userUhid - The UHID of the user.
 * @param {number} maxLevel - The maximum depth to calculate volume for.
 * @returns {Promise<number>} The total team volume.
 */
const getTeamVolume = async (userUhid, maxLevel = 3) => {
    // Find all children within the specified levels
    const childrenRecords = await Level.find({ parent: userUhid, level: { $gte: 1, $lte: maxLevel } }).select('child').lean();
    if (childrenRecords.length === 0) return 0;

    const childrenUhids = childrenRecords.map(c => c.child);
    const ledgers = await Ledger.find({ uhid: { $in: childrenUhids } }).select('wallets.lp').lean();
    
    // Sum the LP wallet balances
    return ledgers.reduce((sum, ledger) => sum + convertToFloat(ledger.wallets.lp), 0);
};

/**
 * Calculates the total LP volume for a user's direct referrals.
 * @param {string} userUhid - The UHID of the user.
 * @returns {Promise<number>} The total direct referral volume.
 */
const getDirectReferralVolume = async (userUhid) => {
    // Find all direct children (level 1)
    const directReferralRecords = await Level.find({ parent: userUhid, level: 1 }).select('child').lean();
    if (directReferralRecords.length === 0) return 0;
    
    const directReferralUhids = directReferralRecords.map(c => c.child);
    const ledgers = await Ledger.find({ uhid: { $in: directReferralUhids } }).select('wallets.lp').lean();

    // Sum the LP wallet balances
    return ledgers.reduce((sum, ledger) => sum + convertToFloat(ledger.wallets.lp), 0);
};

/**
 * Main function to process and distribute Level Booster Bonuses.
 */
const processLevelBoosterBonuses = async () => {
    await connectDB();
    

    // Find all unprocessed daily LP reward events.
    const unprocessedEvents = await LedgerRow.find({
        eventType: 'DAILY_REWARDS_LP',
        levelBoosterBonusProcessed: { $ne: true }
    }).lean();

    if (unprocessedEvents.length === 0) {
        
        await mongoose.disconnect();
        return;
    }

    

    // Process each event one by one.
    for (const event of unprocessedEvents) {
        try {
            
            const depositAmountD128 = event.amount; // amount is already Decimal128

            const depositor = await User.findById(event.userId).lean();
            if (!depositor) {
                
                continue;
            }

            // Loop up to 3 levels up the referral chain.
            for (let level = 1; level <= 3; level++) {
                const levelRecord = await Level.findOne({ child: depositor.uhid, level }).lean();
                if (!levelRecord || !levelRecord.parent) {
                    
                    break; // No more upline users in this chain
                }

                const uplineUser = await User.findOne({ uhid: levelRecord.parent }).lean();
                if (!uplineUser) {
                    
                    continue;
                }

                // Check if the upline user qualifies for the bonus at this specific level.
                const required = QUALIFICATION_LEVELS.find(q => q.level === level);
                if (!required) continue; // Should not happen

                // NOTE: These volume calculations are performance-intensive.
                // For a large number of events, this will result in many database queries.
                const teamVolume = await getTeamVolume(uplineUser.uhid);
                const directVolume = await getDirectReferralVolume(uplineUser.uhid);
                
                const isQualified = (teamVolume >= required.teamVolume && directVolume >= required.directVolume);
                
                if (isQualified) {
                    const bonusPercent = required.bonusRate;
                    const bonusAmount = multiplyDecimal128(depositAmountD128, bonusPercent);

                    const uplineLedger = await getOrCreateLedger(uplineUser._id);
                    
                    // Update wallets and limits
                    uplineLedger.wallets.dailyLevelBoosterBonus = addDecimal128(uplineLedger.wallets.dailyLevelBoosterBonus, bonusAmount);
                    uplineLedger.wallets.levelBoosterBonus = addDecimal128(uplineLedger.wallets.levelBoosterBonus, bonusAmount);
                    uplineLedger.wallets.communityRewards = addDecimal128(uplineLedger.wallets.communityRewards, bonusAmount);
                    uplineLedger.limits.fiveXLimit.used = addDecimal128(uplineLedger.limits.fiveXLimit.used, bonusAmount);
                    uplineLedger.limits.zeroRiskLimit.used = addDecimal128(uplineLedger.limits.zeroRiskLimit.used, bonusAmount);
                    
                    await uplineLedger.save();

                    // Create a log entry for this bonus
                    const description = `Level Booster Bonus (Level ${level} - ${bonusPercent * 100}%) from user ${depositor.username}`;
                    await DailyRewardLog.create({
                        userId: uplineUser._id,
                        rewardType: 'levelBoosterBonus',
                        amount: bonusAmount,
                        details: {
                            triggeringUserId: depositor._id,
                            triggeringEventId: event._id,
                            description,
                            level,
                            rate: mongoose.Types.Decimal128.fromString(bonusPercent.toString())
                        }
                    });
                    
                } else {
                     
                }
            }

            // Mark this event as processed to prevent double-awarding.
            await LedgerRow.findByIdAndUpdate(event._id, { $set: { levelBoosterBonusProcessed: true } });
            

        } catch (error) {
            console.error(`[Error] Failed to process event ${event._id}. Reason:`, error);
        }
    }

    
    await mongoose.disconnect();
    
};

// Run the script
processLevelBoosterBonuses(); 
