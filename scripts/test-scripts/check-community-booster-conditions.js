const mongoose = require('mongoose');
const Level = require('../../models/Level');
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/xrpmigrate', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Community Booster Tiers Configuration
const COMMUNITY_TIERS = {
    10000: {
        directRequired: 2000,    // Volume required from level 1 users
        teamRequired: 10000,     // Volume required from levels 1-3
        bonusLevel: 1,           // Which cascade level to double
        baseRate: 0.12          // Original cascade rate that will be doubled
    },
    20000: {
        directRequired: 6000,
        teamRequired: 20000,
        bonusLevel: 2,
        baseRate: 0.10
    },
    30000: {
        directRequired: 12000,
        teamRequired: 30000,
        bonusLevel: 3,
        baseRate: 0.07
    }
};

// Cascade level requirements (needed for community booster)
const CASCADE_REQUIREMENTS = [
    { level: 1, minDirects: 1, minSelfLP: 9 },
    { level: 2, minDirects: 2, minSelfLP: 9 },
    { level: 3, minDirects: 3, minSelfLP: 9 }
];

async function getTeamVolume(userUhid, maxLevel = 3) {
    const childrenRecords = await Level.find({ 
        parent: userUhid, 
        level: { $gte: 1, $lte: maxLevel } 
    }).select('child').lean();
    
    if (childrenRecords.length === 0) return 0;
    
    const childrenUhids = childrenRecords.map(c => c.child);
    const ledgers = await Ledger.find({ 
        uhid: { $in: childrenUhids } 
    }).select('wallets.lp').lean();
    
    return ledgers.reduce((sum, ledger) => {
        const lpValue = ledger.wallets.lp ? parseFloat(ledger.wallets.lp.toString()) : 0;
        return sum + lpValue;
    }, 0);
}

async function checkCommunityBoosterConditions(uhid) {
    try {
        // Get user details
        const user = await User.findOne({ uhid }).lean();
        if (!user) {
            console.log('User not found');
            return;
        }

        console.log(`\nChecking Community Booster conditions for user: ${user.username} (${uhid})`);

        // Get direct referral count and self LP
        const directCount = await Level.countDocuments({ parent: uhid, level: 1 });
        const ledger = await Ledger.findOne({ uhid }).select('wallets.lp').lean();
        const selfLP = ledger ? parseFloat(ledger.wallets.lp.toString()) : 0;

        console.log('\nBasic Stats:');
        console.log(`- Direct Referrals: ${directCount}`);
        console.log(`- Self LP: ${selfLP} XRP`);

        // Calculate volumes
        const directVolume = await getTeamVolume(uhid, 1);  // Level 1 volume
        const teamVolume = await getTeamVolume(uhid, 3);    // Level 1-3 volume

        console.log('\nVolume Stats:');
        console.log(`- Direct Volume (Level 1): ${directVolume} XRP`);
        console.log(`- Team Volume (Levels 1-3): ${teamVolume} XRP`);

        // Check each tier's requirements
        console.log('\nTier Qualification Check:');
        for (const [tier, requirements] of Object.entries(COMMUNITY_TIERS)) {
            console.log(`\nTier ${tier} XRP:`);
            
            // Check cascade level requirements first
            const cascadeReq = CASCADE_REQUIREMENTS[requirements.bonusLevel - 1];
            const meetsBasicRequirements = directCount >= cascadeReq.minDirects && selfLP >= cascadeReq.minSelfLP;
            
            console.log(`Cascade Level ${requirements.bonusLevel} Requirements:`);
            console.log(`- Required Direct Referrals: ${cascadeReq.minDirects} (Has: ${directCount})`);
            console.log(`- Required Self LP: ${cascadeReq.minSelfLP} (Has: ${selfLP})`);
            console.log(`- Basic Requirements Met: ${meetsBasicRequirements ? 'YES' : 'NO'}`);

            if (meetsBasicRequirements) {
                const meetsDirectVolume = directVolume >= requirements.directRequired;
                const meetsTeamVolume = teamVolume >= requirements.teamRequired;
                
                console.log('\nVolume Requirements:');
                console.log(`- Required Direct Volume: ${requirements.directRequired} (Has: ${directVolume})`);
                console.log(`- Required Team Volume: ${requirements.teamRequired} (Has: ${teamVolume})`);
                console.log(`- Direct Volume Requirement Met: ${meetsDirectVolume ? 'YES' : 'NO'}`);
                console.log(`- Team Volume Requirement Met: ${meetsTeamVolume ? 'YES' : 'NO'}`);
                
                if (meetsDirectVolume && meetsTeamVolume) {
                    console.log(`\n✅ QUALIFIED for Tier ${tier} - Will double Level ${requirements.bonusLevel} rate to ${requirements.baseRate * 200}%`);
                } else {
                    console.log(`\n❌ NOT QUALIFIED for Tier ${tier}`);
                }
            } else {
                console.log(`\n❌ NOT QUALIFIED for Tier ${tier} - Basic cascade requirements not met`);
            }
        }

    } catch (error) {
        console.error('Error checking community booster conditions:', error);
    } finally {
        mongoose.disconnect();
    }
}

// Check the specified UHID
const targetUhid = "17469855250636";
console.log(`\nAnalyzing Community Booster conditions for UHID: ${targetUhid}\n`);
checkCommunityBoosterConditions(targetUhid); 