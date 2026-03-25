const DailyUserLp = require('../models/DailyUserLp');
const User = require('../models/User');
const moment = require('moment');

/**
 * Calculate a user's team LP for a specific date
 * @param {string} uhid - User's UHID
 * @param {Date} date - Date to calculate LP for
 * @param {Object} options - Additional options
 * @param {number} options.maxLevel - Maximum level to consider (default: 16)
 * @param {boolean} options.includeBreakdown - Whether to include LP breakdown by level
 * @returns {Promise<Object>} Team LP data
 */
async function calculateTeamLp(uhid, date = new Date(), options = {}) {
    const { maxLevel = 16, includeBreakdown = false } = options;
    
    try {
        // Get user's ID
        const user = await User.findOne({ uhid }).select('_id').lean();
        if (!user) {
            throw new Error(`User not found: ${uhid}`);
        }

        // Get the daily LP record for this date
        const startOfDay = moment(date).startOf('day').toDate();
        const dailyLp = await DailyUserLp.findOne({
            userId: user._id,
            date: startOfDay
        }).lean();

        if (!dailyLp) {
            return {
                selfLp: '0.0',
                teamLp: '0.0',
                ...(includeBreakdown && { teamLpByLevel: [] })
            };
        }

        // Filter team LP by level if maxLevel is specified
        let teamLp = '0.0';
        let teamLpByLevel = [];

        if (dailyLp.teamLpByLevel) {
            teamLpByLevel = dailyLp.teamLpByLevel.filter(item => item.level <= maxLevel);
            teamLp = teamLpByLevel.reduce((sum, item) => {
                return (parseFloat(sum) + parseFloat(item.amount.toString())).toString();
            }, '0.0');
        }

        return {
            selfLp: dailyLp.selfLp.toString(),
            teamLp,
            ...(includeBreakdown && { teamLpByLevel })
        };
    } catch (error) {
        console.error('Error calculating team LP:', error);
        throw error;
    }
}

/**
 * Calculate team LP for multiple dates
 * @param {string} uhid - User's UHID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {Object} options - Additional options
 * @returns {Promise<Object[]>} Array of daily team LP data
 */
async function calculateTeamLpHistory(uhid, startDate, endDate, options = {}) {
    try {
        // Get user's ID
        const user = await User.findOne({ uhid }).select('_id').lean();
        if (!user) {
            throw new Error(`User not found: ${uhid}`);
        }

        // Get daily LP records for the date range
        const dailyLps = await DailyUserLp.find({
            userId: user._id,
            date: {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            }
        }).sort({ date: 1 }).lean();

        return dailyLps.map(daily => ({
            date: daily.date,
            selfLp: daily.selfLp.toString(),
            teamLp: daily.teamLp.toString(),
            ...(options.includeBreakdown && { 
                teamLpByLevel: daily.teamLpByLevel.filter(
                    item => item.level <= (options.maxLevel || 16)
                )
            })
        }));
    } catch (error) {
        console.error('Error calculating team LP history:', error);
        throw error;
    }
}

module.exports = {
    calculateTeamLp,
    calculateTeamLpHistory
}; 