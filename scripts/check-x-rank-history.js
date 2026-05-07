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

    
    
    

    const changes = await findQualificationChanges(uhid, startDate, endDate);
    
    changes.forEach(change => {
        
        
        // Show qualification status
        if (change.qualified) {
            
            
            
            
            Object.entries(change.teamLPDetails.lpByLevel).forEach(([level, lp]) => {
                
            });
            
            change.teamLPDetails.topThreeLevels.forEach(({level, lp}) => {
                
            });
            
            
            
        } else {
            
            
            
            
            Object.entries(change.teamLPDetails.lpByLevel).forEach(([level, lp]) => {
                
            });
        }
        
        if (change.previousStatus) {
            console.log('\nPrevious Status:', change.previousStatus.qualified ? 
                `Qualified for ${change.previousStatus.tier}` : 
                'Not Qualified'
            );
            if (change.previousStatus.qualified) {
                
                
            }
        }
        
    });

    // Show current team LP structure
    
    const currentTeamLP = await getTeamLPAtDate(uhid, new Date());
    
    
    Object.entries(currentTeamLP.lpByLevel).forEach(([level, lp]) => {
        
    });
    
    currentTeamLP.topThreeLevels.forEach(({level, lp}) => {
        
    });
}

main().catch(console.error).finally(() => process.exit()); 
