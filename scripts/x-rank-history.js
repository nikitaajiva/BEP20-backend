const mongoose = require('mongoose');
const User = require('../models/User');
const LedgerRow = require('../models/LedgerRow');
const Level = require('../models/Level');
const { X_TIERS } = require('../jobs/eventHandlers/x1Handler');
const { meetsTeamVolumeRequirement } = require('../utils/teamUtils');

/**
 * Calculate LP balance at a specific date for a user
 */
async function getLPBalanceAtDate(userId, targetDate) {
    const deposits = await LedgerRow.find({
        userId,
        walletTo: 'LP',
        ts: { $lte: targetDate }
    }).sort({ ts: 1 });

    const withdrawals = await LedgerRow.find({
        userId,
        walletFrom: 'LP',
        ts: { $lte: targetDate }
    }).sort({ ts: 1 });

    let balance = 0;
    deposits.forEach(tx => {
        balance += parseFloat(tx.amount.toString());
    });
    withdrawals.forEach(tx => {
        balance -= parseFloat(tx.amount.toString());
    });

    return balance;
}

/**
 * Get team members' UHIDs up to specified depth with their levels
 */
async function getTeamMembersWithLevels(uhid, maxDepth = 3) {
    const teamMembers = [];
    
    // Get all levels up to maxDepth
    const levels = await Level.find({
        parent: uhid,
        level: { $lte: maxDepth }
    }).lean();

    // Get all unique child UHIDs
    const childUhids = [...new Set(levels.map(l => l.child))];
    
    // Get user details for all children
    const users = await User.find({
        uhid: { $in: childUhids }
    }).select('uhid _id').lean();

    // Create a map of UHID to userId for quick lookup
    const uhidToUserMap = {};
    users.forEach(user => {
        uhidToUserMap[user.uhid] = user._id;
    });

    // Combine level info with user info
    levels.forEach(level => {
        if (uhidToUserMap[level.child]) {
            teamMembers.push({
                uhid: level.child,
                userId: uhidToUserMap[level.child],
                level: level.level
            });
        }
    });

    return teamMembers;
}

/**
 * Calculate team LP at a specific date
 * Implements three-wing distribution rule
 */
async function getTeamLPAtDate(uhid, targetDate) {
    // Get team members with their levels
    const teamMembers = await getTeamMembersWithLevels(uhid);
    
    // Group members by level
    const membersByLevel = teamMembers.reduce((acc, member) => {
        if (!acc[member.level]) acc[member.level] = [];
        acc[member.level].push(member);
        return acc;
    }, {});

    // Calculate LP for each level
    const lpByLevel = {};
    for (const [level, members] of Object.entries(membersByLevel)) {
        let levelLP = 0;
        
        // Calculate LP for each member at this level
        for (const member of members) {
            const memberLP = await getLPBalanceAtDate(member.userId, targetDate);
            levelLP += memberLP;
        }
        
        lpByLevel[level] = levelLP;
    }

    // Apply three-wing distribution rule
    // Sort levels by LP volume
    const sortedLevels = Object.entries(lpByLevel)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);  // Take top 3 levels

    const totalTeamLP = sortedLevels.reduce((sum, [, lp]) => sum + lp, 0);

    return {
        totalTeamLP,
        lpByLevel,
        topThreeLevels: sortedLevels.map(([level, lp]) => ({
            level: parseInt(level),
            lp
        }))
    };
}

/**
 * Get qualification status for a specific date
 */
async function getQualificationStatusAtDate(uhid, targetDate) {
    // Get user's LP balance at the target date
    const user = await User.findOne({ uhid }).select('_id');
    const selfLP = await getLPBalanceAtDate(user._id, targetDate);
    
    // Get team LP at target date
    const teamLPInfo = await getTeamLPAtDate(uhid, targetDate);

    // Check qualification for each tier
    const tiers = Object.entries(X_TIERS).reverse();
    for (const [tier, requirements] of tiers) {
        // Check self LP requirement
        if (selfLP < requirements.selfLP) {
            continue;
        }

        // Check team LP requirement
        if (teamLPInfo.totalTeamLP >= requirements.teamLP) {
            return {
                qualified: true,
                tier,
                selfLP,
                teamLP: teamLPInfo.totalTeamLP,
                teamLPDetails: teamLPInfo,
                requirements
            };
        }
    }

    return {
        qualified: false,
        selfLP,
        teamLP: teamLPInfo.totalTeamLP,
        teamLPDetails: teamLPInfo,
        requirements: null
    };
}

/**
 * Get qualification history between two dates
 */
async function getQualificationHistory(uhid, startDate, endDate) {
    const history = [];
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const status = await getQualificationStatusAtDate(uhid, currentDate);
        history.push({
            date: new Date(currentDate),
            ...status
        });
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return history;
}

/**
 * Find dates when qualification status changed
 */
async function findQualificationChanges(uhid, startDate, endDate) {
    const changes = [];
    let prevStatus = null;
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        const status = await getQualificationStatusAtDate(uhid, currentDate);
        
        // If this is first check or status changed from previous day
        if (!prevStatus || 
            prevStatus.qualified !== status.qualified || 
            (prevStatus.tier !== status.tier)) {
            changes.push({
                date: new Date(currentDate),
                ...status,
                previousStatus: prevStatus
            });
        }
        
        prevStatus = status;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return changes;
}

module.exports = {
    getQualificationStatusAtDate,
    getQualificationHistory,
    findQualificationChanges,
    getLPBalanceAtDate,
    getTeamLPAtDate
}; 
