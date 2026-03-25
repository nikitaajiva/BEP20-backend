require('dotenv').config();
const { 
    getQualificationStatusAtDate, 
    getQualificationHistory,
    findQualificationChanges,
    getTeamLPAtDate
} = require('./x-rank-history');

function formatLP(lp) {
    return parseFloat(lp).toFixed(2);
}

async function main() {
    const uhid = process.argv[2];
    if (!uhid) {
        console.error('Please provide UHID as argument');
        process.exit(1);
    }

    // Default to last 30 days if no dates provided
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    if (process.argv[3] && process.argv[4]) {
        startDate = new Date(process.argv[3]);
        endDate = new Date(process.argv[4]);
    }

    console.log(`Checking X-Rank history for UHID ${uhid}`);
    console.log(`Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log('\n=== Qualification Changes ===');

    const changes = await findQualificationChanges(uhid, startDate, endDate);
    
    changes.forEach(change => {
        console.log('\nDate:', change.date.toISOString().split('T')[0]);
        
        // Show qualification status
        if (change.qualified) {
            console.log(`Status: Qualified for ${change.tier}`);
            console.log(`Self LP: ${formatLP(change.selfLP)}`);
            console.log(`Total Team LP: ${formatLP(change.teamLP)}`);
            console.log('\nTeam LP Breakdown by Level:');
            Object.entries(change.teamLPDetails.lpByLevel).forEach(([level, lp]) => {
                console.log(`  Level ${level}: ${formatLP(lp)}`);
            });
            console.log('\nTop 3 Levels (Three-Wing Distribution):');
            change.teamLPDetails.topThreeLevels.forEach(({level, lp}) => {
                console.log(`  Level ${level}: ${formatLP(lp)}`);
            });
            console.log(`\nRequirements for ${change.tier}:`);
            console.log(`  Self LP Required: ${change.requirements.selfLP}`);
            console.log(`  Team LP Required: ${change.requirements.teamLP}`);
        } else {
            console.log('Status: Not Qualified');
            console.log(`Self LP: ${formatLP(change.selfLP)}`);
            console.log(`Total Team LP: ${formatLP(change.teamLP)}`);
            console.log('\nTeam LP Breakdown by Level:');
            Object.entries(change.teamLPDetails.lpByLevel).forEach(([level, lp]) => {
                console.log(`  Level ${level}: ${formatLP(lp)}`);
            });
        }
        
        if (change.previousStatus) {
            console.log('\nPrevious Status:', change.previousStatus.qualified ? 
                `Qualified for ${change.previousStatus.tier}` : 
                'Not Qualified'
            );
            if (change.previousStatus.qualified) {
                console.log(`Previous Self LP: ${formatLP(change.previousStatus.selfLP)}`);
                console.log(`Previous Team LP: ${formatLP(change.previousStatus.teamLP)}`);
            }
        }
        console.log('-'.repeat(40));
    });

    // Show current team LP structure
    console.log('\n=== Current Team LP Structure ===');
    const currentTeamLP = await getTeamLPAtDate(uhid, new Date());
    console.log(`\nTotal Team LP: ${formatLP(currentTeamLP.totalTeamLP)}`);
    console.log('\nLP by Level:');
    Object.entries(currentTeamLP.lpByLevel).forEach(([level, lp]) => {
        console.log(`Level ${level}: ${formatLP(lp)}`);
    });
    console.log('\nTop 3 Levels (Three-Wing Distribution):');
    currentTeamLP.topThreeLevels.forEach(({level, lp}) => {
        console.log(`Level ${level}: ${formatLP(lp)}`);
    });
}

main().catch(console.error).finally(() => process.exit()); 