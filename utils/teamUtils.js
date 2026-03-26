const Level = require('../models/Level');
const Ledger = require('../models/Ledger');
const { convertToFloat } = require('./decimal128Utils');

/**
 * Gets the total LP balance for a user's team up to specified depth
 * @param {String} uhid - User's UHID
 * @param {Number} depth - Maximum level depth to calculate
 * @returns {Promise<Number>} Total team LP
 */
const getTeamVolume = async (uhid, depth = 1) => {
    try {
        // Get all team members up to specified depth
        const teamMembers = await Level.find({
            parent: uhid,
            level: { $lte: depth }
        }).distinct('child');

        if (!teamMembers.length) {
            return 0;
        }

        // Get sum of current LP balances for all team members
        const ledgers = await Ledger.find({
            uhid: { $in: teamMembers }
        }).select('wallets.lp').lean();

        // Sum up all LP balances
        const totalLP = ledgers.reduce((sum, ledger) => {
            return sum + convertToFloat(ledger.wallets?.lp || 0);
        }, 0);

        return totalLP;
    } catch (error) {
        console.error('[TeamUtils] Error calculating team LP:', error);
        throw error;
    }
};

async function getDirectChildrenCount(uhid) {
    const directChildren = await Level.find({
        parent: uhid,
        level: 1
    }).lean();
    return directChildren.length;
}
/**
 * Get direct children's team volumes
 */
async function getDirectChildrenVolumes(uhid) {
    // Get all direct children (level 1)
    const directChildren = await Level.find({
        parent: uhid,
        level: 1
    }).lean();

    const childrenVolumes = await Promise.all(directChildren.map(async (child) => {
        // Get child's personal LP
        const childLedger = await Ledger.findOne({ uhid: child.child }).select('wallets.lp').lean();
        const personalLP = childLedger ? parseFloat(childLedger.wallets.lp.toString()) : 0;

        // Get child's team volume
        const teamVolume = await getTeamVolume(child.child, 16);

        return {
            uhid: child.child,
            personalLP,
            teamVolume,
            totalVolume: personalLP + teamVolume
        };
    }));

    return childrenVolumes.sort((a, b) => b.totalVolume - a.totalVolume);
}


const meetsTeamVolumeRequirement = async (uhid, requiredTeamVolume) => {
    const directChildren = await getDirectChildrenVolumes(uhid);
    
    if (!directChildren || directChildren.length === 0) {
        return false;
    }

    // Sort children by volume in descending order
    const sortedChildren = [...directChildren].sort((a, b) => b.totalVolume - a.totalVolume);
    
    // Check if we have at least two children with 1/3rd of required volume each
    const oneThirdVolume = requiredTeamVolume / 3;
    const qualifiedChildren = sortedChildren.filter(child => child.totalVolume >= oneThirdVolume);
    
    if (qualifiedChildren.length < 2) {
        return false;
    }

    // Get top two qualified children
    const topTwoQualified = qualifiedChildren.slice(0, 2);
    
    // Calculate remaining volume from other children
    const remainingChildren = directChildren.filter(child => 
        !topTwoQualified.some(top => top.uhid === child.uhid)
    );
    const remainingVolume = remainingChildren.reduce((sum, child) => sum + child.totalVolume, 0);

    // Verify total volume meets requirements:
    // 1. Two children must each have >= 1/3rd of required volume
    // 2. Remaining volume must be >= remaining 1/3rd
    return (
        topTwoQualified[0].totalVolume >= oneThirdVolume &&
        topTwoQualified[1].totalVolume >= oneThirdVolume &&
        remainingVolume >= oneThirdVolume
    );
};

module.exports = {
    getTeamVolume,
    meetsTeamVolumeRequirement,
    getDirectChildrenCount,
    getDirectChildrenVolumes   
};
