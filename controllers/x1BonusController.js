const mongoose = require('mongoose');
const moment = require('moment');
const User = require('../models/User');
const Level = require('../models/Level');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const { meetsTeamVolumeRequirement } = require('../utils/teamUtils');
const { convertToFloat } = require('../utils/decimal128Utils');

// X1-X5 Tiers Configuration
const X_TIERS = {
    X: {
        selfLP: 1000,
        teamLP: 15000,
        rate: 0.10
    },
    X1: {
        selfLP: 1500,
        teamLP: 30000,
        rate: 0.20
    },
    X2: {
        selfLP: 3000,
        teamLP: 120000,
        rate: 0.25
    },
    X3: {
        selfLP: 6000,
        teamLP: 300000,
        rate: 0.30
    },
    X4: {
        selfLP: 12000,
        teamLP: 900000,
        rate: 0.40
    },
    X5: {
        selfLP: 20000,
        teamLP: 1500000,
        rate: 0.50
    }
};

/**
 * Utility to resolve a user from _id, uhid or username.
 */
const findUserByIdentifier = async (identifier) => {
    if (!identifier) return null;
    // _id check (24 hex chars)
    if (mongoose.isValidObjectId(identifier)) {
        const byId = await User.findById(identifier).lean();
        if (byId) return byId;
    }
    // try uhid or username
    const byUhid = await User.findOne({ uhid: identifier }).lean();
    if (byUhid) return byUhid;
    const byUsername = await User.findOne({ username: identifier }).lean();
    if (byUsername) return byUsername;
    return null;
};

/**
 * Calculate team LP for a user including wing distribution
 */
async function calculateTeamLPWithWings(uhid) {
    // Get direct team members (level 1)
    const directTeam = await Level.find({ 
        parent: uhid, 
        level: 1 
    }).select('child').lean();

    const directUhids = directTeam.map(t => t.child);
    
    // Get LP for each direct member and their teams
    const wingData = await Promise.all(directUhids.map(async (memberUhid) => {
        // Get all team members under this wing (all levels)
        const allTeamMembers = await Level.find({
            parent: memberUhid,
            level: { $gte: 1 }
        }).select('child').lean();

        const allTeamUhids = [...new Set([memberUhid, ...allTeamMembers.map(t => t.child)])];
        
        // Get LP for all members in this wing
        const teamLedgers = await Ledger.find({
            uhid: { $in: allTeamUhids }
        }).select('wallets.lp').lean();

        const totalWingLP = teamLedgers.reduce((sum, l) => sum + convertToFloat(l.wallets?.lp || 0), 0);

        return {
            uhid: memberUhid,
            totalLP: totalWingLP
        };
    }));

    // Sort wings by LP volume
    wingData.sort((a, b) => b.totalLP - a.totalLP);

    // Create three-wing distribution
    const wingTotals = {};
    
    // Wing 1: Highest LP downline
    if (wingData.length > 0 && wingData[0].totalLP > 0) {
        wingTotals.wing1 = wingData[0].totalLP;
    }
    
    // Wing 2: Second highest LP downline
    if (wingData.length > 1 && wingData[1].totalLP > 0) {
        wingTotals.wing2 = wingData[1].totalLP;
    }
    
    // Wing 3: Sum of all remaining downlines
    if (wingData.length > 2) {
        const remainingLP = wingData.slice(2).reduce((sum, wing) => sum + wing.totalLP, 0);
        if (remainingLP > 0) {
            wingTotals.wing3 = remainingLP;
        }
    }

    const totalTeamLP = wingData.reduce((sum, wing) => sum + wing.totalLP, 0);

    return {
        wingTotals,
        total: totalTeamLP
    };
}

/**
 * GET /api/bonus/x1/summary
 * Query params: user, date(YYYY-MM-DD)
 */
const getX1Summary = async (req, res) => {
    try {
        const { user: identifier, date } = req.query;
        if (!identifier) return res.status(400).json({ msg: 'user query param required' });
        
        const user = await findUserByIdentifier(identifier);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const targetDate = date ? moment(date).startOf('day') : moment().startOf('day');
        const nextDate = moment(targetDate).add(1, 'day');

        // Get self LP
        const ledger = await Ledger.findOne({ userId: user._id }).select('wallets.lp').lean();
        const selfLP = ledger ? convertToFloat(ledger.wallets.lp) : 0;

        // Check team LP with three-wing distribution
        const teamLPResults = {};
        for (const [tier, requirements] of Object.entries(X_TIERS)) {
            const meetsTeam = await meetsTeamVolumeRequirement(user.uhid, requirements.teamLP);
            teamLPResults[tier] = {
                required: requirements.teamLP,
                meets: meetsTeam
            };
        }

        // Determine current qualification tier
        let currentTier = null;
        let currentRate = 0;
        for (const [tier, requirements] of Object.entries(X_TIERS).reverse()) {
            if (selfLP >= requirements.selfLP && teamLPResults[tier].meets) {
                currentTier = tier;
                currentRate = requirements.rate;
                break;
            }
        }

        // Get credited events for the date
        const targetDate2025 = moment(targetDate).year(2025);
        const nextDate2025 = moment(nextDate).year(2025);

        const bonusEvents = await LedgerRow.find({
            userId: user._id,
            category: 'X_BONUS',
            ts: { $gte: targetDate2025.toDate(), $lt: nextDate2025.toDate() }
        })
        .populate('refId', 'username')
        .lean();

        const formattedEvents = bonusEvents.map(event => ({
            ts: event.ts,
            amount: convertToFloat(event.amount),
            walletFrom: event.refId?.username || 'Unknown',
            walletTo: user.username,
            narrative: event.narrative,
            meta: event.meta
        }));

        const summary = {
            user: { 
                _id: user._id, 
                uhid: user.uhid, 
                username: user.username 
            },
            qualification: {
                currentTier,
                currentRate: currentRate * 100, // Convert to percentage
                selfLP,
                teamLP: teamLPResults,
                requirements: X_TIERS
            },
            credited: {
                total: formattedEvents.reduce((sum, e) => sum + e.amount, 0),
                events: formattedEvents
            }
        };

        return res.json(summary);
    } catch (err) {
        console.error('getX1Summary error:', err);
        return res.status(500).json({ msg: 'Server error' });
    }
};

/**
 * GET /api/bonus/x1/details
 * Query params: user, type(team), date(YYYY-MM-DD)
 */
const getX1Details = async (req, res) => {
    try {
        const { user: identifier, type, date } = req.query;
        if (!identifier) return res.status(400).json({ msg: 'user query param required' });
        if (!type || type !== 'team') return res.status(400).json({ msg: 'type must be "team"' });

        const user = await findUserByIdentifier(identifier);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Get all direct team members (level 1)
        const directTeam = await Level.find({ 
            parent: user.uhid, 
            level: 1 
        })
        .select('child')
        .lean();

        const directUhids = directTeam.map(t => t.child);

        // Get team members' details
        const teamMembers = await User.find({
            uhid: { $in: directUhids }
        })
        .select('username uhid')
        .lean();

        // Get LP for each team member
        const teamLedgers = await Ledger.find({
            uhid: { $in: directUhids }
        })
        .select('uhid wallets.lp')
        .lean();

        // Create LP map
        const lpMap = {};
        teamLedgers.forEach(ledger => {
            lpMap[ledger.uhid] = convertToFloat(ledger.wallets?.lp || 0);
        });

        // Calculate team LP with wing distribution for each member
        const teamDetails = await Promise.all(teamMembers.map(async (member) => {
            const teamLPData = await calculateTeamLPWithWings(member.uhid);
            return {
                username: member.username,
                uhid: member.uhid,
                selfLP: lpMap[member.uhid] || 0,
                teamLP: teamLPData.wingTotals,
                totalTeamLP: teamLPData.total
            };
        }));

        // Sort by total team LP descending
        teamDetails.sort((a, b) => b.totalTeamLP - a.totalTeamLP);

        return res.json({
            user: { 
                _id: user._id, 
                uhid: user.uhid, 
                username: user.username 
            },
            teamDetails
        });
    } catch (err) {
        console.error('getX1Details error:', err);
        return res.status(500).json({ msg: 'Server error' });
    }
};

module.exports = {
    getX1Summary,
    getX1Details
};
