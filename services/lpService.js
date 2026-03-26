const User = require('../models/User');
const Level = require('../models/Level');
const mongoose = require('mongoose');

/**
 * Updates the totalTeamLp for all upline sponsors of a user.
 * This should be called whenever a user's own LP balance increases.
 * 
 * @param {string} userUhid - The UHID of the user whose LP was updated.
 * @param {mongoose.Types.Decimal128} lpAmountAdded - The amount of LP that was added.
 */
const updateUplineTeamLp = async (userUhid, lpAmountAdded) => {
    if (!userUhid || !lpAmountAdded || lpAmountAdded.toString() === '0.0' || lpAmountAdded.toString() === '0') {
        console.log('Skipping team LP update: Invalid input or zero amount.');
        return;
    }

    try {
        // Find all upline parents for the user, up to 16 levels.
        const uplineLevels = await Level.find({ 
            child: userUhid, 
            level: { $gte: 1 } 
        }).select('parent').lean();

        if (uplineLevels.length === 0) {
            console.log(`No upline found for user ${userUhid}. No team LP to update.`);
            return;
        }

        const parentUhids = uplineLevels.map(level => level.parent);

        // Use updateMany with $inc to atomically update the counters for all parents.
        const result = await User.updateMany(
            { uhid: { $in: parentUhids } },
            { $inc: { 'counters.totalTeamLp': lpAmountAdded } }
        );

        console.log(`Successfully updated totalTeamLp for ${result.modifiedCount} upline members of user ${userUhid}.`);

    } catch (error) {
        console.error(`Error updating team LP for user ${userUhid}:`, error);
        // Depending on the application's needs, you might want to re-throw the error
        // or handle it in a specific way (e.g., add to a retry queue).
        throw error;
    }
};

/**
 * Decreases the totalTeamLp for all upline sponsors of a user.
 * This should be called whenever a user's own LP balance is withdrawn or reduced.
 * 
 * @param {string} userUhid - The UHID of the user whose LP was reduced.
 * @param {mongoose.Types.Decimal128} lpAmountRemoved - The amount of LP that was removed.
 */
const decreaseUplineTeamLp = async (userUhid, lpAmountRemoved) => {
    if (!userUhid || !lpAmountRemoved || lpAmountRemoved.toString() === '0.0' || lpAmountRemoved.toString() === '0') {
        console.log('Skipping team LP decrease: Invalid input or zero amount.');
        return;
    }

    try {
        const uplineLevels = await Level.find({ 
            child: userUhid, 
            level: { $gte: 1, $lte: 16 } 
        }).select('parent').lean();

        if (uplineLevels.length === 0) {
            console.log(`No upline found for user ${userUhid}. No team LP to decrease.`);
            return;
        }

        const parentUhids = uplineLevels.map(level => level.parent);
        
        // To decrement, we increment by a negative value.
        const amountToDecrement = mongoose.Types.Decimal128.fromString(
            (parseFloat(lpAmountRemoved.toString()) * -1).toString()
        );

        const result = await User.updateMany(
            { uhid: { $in: parentUhids } },
            { $inc: { 'counters.totalTeamLp': amountToDecrement } }
        );

        console.log(`Successfully decreased totalTeamLp for ${result.modifiedCount} upline members of user ${userUhid}.`);

    } catch (error) {
        console.error(`Error decreasing team LP for user ${userUhid}:`, error);
        throw error;
    }
};

module.exports = {
    updateUplineTeamLp,
    decreaseUplineTeamLp,
}; 