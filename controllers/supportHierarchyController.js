const User = require('../models/User');
const Level = require('../models/Level');
const { fetchAndMergeReferralData } = require('../utils/hierarchyUtils');

// GET /api/support/hierarchy/top-level
exports.getTopLevelUsers = async (req, res) => {
    try {
        // Find users who do not appear as a 'child' in the Level collection.
        // This is one way to identify users without a sponsor.
        // A potentially more robust way is to find users with no sponsorId.
        const allChildrenUhids = await Level.distinct('child');
        
        // Find users whose UHID is not in the list of children.
        const topLevelUsers = await User.find({ 
            uhid: { $nin: allChildrenUhids } 
        }).select('uhid').lean();

        const topLevelUhids = topLevelUsers.map(u => u.uhid);

        const data = await fetchAndMergeReferralData(topLevelUhids, 1, null, null);

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error("API getTopLevelUsers Error:", error);
        res.status(500).json({ success: false, message: 'Internal server error while fetching top-level users.' });
    }
};

// GET /api/support/hierarchy/descendants/:uhid
exports.getDescendants = async (req, res, next) => {
  try {
    const { uhid } = req.params;
    
    // In the context of the support dashboard, there's no "viewer", 
    // so we pass null to avoid leaking sensitive data like WhatsApp numbers.
    const results = await fetchAndMergeReferralData(
        await Level.find({ parent: uhid, level: 1 }).select('child -_id').lean().then(r => r.map(d => d.child)),
        1,       // Level is 1 for direct descendants
        null,    // viewerUhid is null
        uhid     // parentUhid
    );

    res.json({ success: true, uhid, descendants: results });
  } catch (err) {
    console.error(`Error in /support/hierarchy/descendants/${req.params.uhid}:`, err);
    next(err);
  }
}; 
