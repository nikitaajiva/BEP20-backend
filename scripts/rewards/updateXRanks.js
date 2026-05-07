// scripts/rewards/updateXrank.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..','..', '.env') });
const connectDB = require("../../config/db");
const User = require('../../models/User');
const { getUserQualificationTier } = require('../../jobs/eventHandlers/x1Handler');
let pMap;
(async () => {
  pMap = (await import("p-map")).default;
})();

const updateXRanks = async (options = {}) => {
    const isDryRun = options.dryRun || false;
    const batchSize = options.batchSize || 200; // bigger batch
    const concurrency = options.concurrency || 20; // how many users in parallel
    const uhid = options.uhid || null;

    
    

    try {
        await connectDB();
        

        let processedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        // ---------- Single user mode ----------
        if (uhid) {
            
            const user = await User.findOne({ uhid }).lean();

            if (!user) {
                
                return;
            }

            try {
                
                    // 🚫 Skip blocked UHID
                if (user.uhid === "1760448463650") {
                    
                    return null;
                }

                const { tier } = await getUserQualificationTier(user.uhid);

                if (!isDryRun) {
                    const updateResult = await User.updateOne(
                        { _id: user._id },
                        { $set: { xRank: tier, xRankLastUpdated: new Date() } }
                    );

                    if (updateResult.modifiedCount > 0) {
                        updatedCount++;
                        
                    }
                } else {
                    
                }
                processedCount++;
            } catch (error) {
                errorCount++;
                console.error(`❌ Error processing user ${user.username}:`, error);
            }
        } else {
            // ---------- All users mode (batch) ----------
            
            let lastProcessedId = null;

            while (true) {
                const query = lastProcessedId ? { _id: { $gt: lastProcessedId } } : {};
                const users = await User.find(query).sort({ _id: 1 }).limit(batchSize).lean();

                if (users.length === 0) break;

                const updates = await pMap(users, async (user) => {
                    try {
                        const { tier } = await getUserQualificationTier(user.uhid);

                        if (!isDryRun) {
                            return {
                                updateOne: {
                                    filter: { _id: user._id },
                                    update: {
                                        $set: { xRank: tier, xRankLastUpdated: new Date() },
                                    },
                                },
                            };
                        } else {
                            
                            return null;
                        }
                    } catch (err) {
                        errorCount++;
                        console.error(`❌ Error processing ${user.username}:`, err);
                        return null;
                    }
                }, { concurrency });

                // Bulk update once per batch
                const ops = updates.filter(Boolean);
                if (!isDryRun && ops.length > 0) {
                    const result = await User.bulkWrite(ops, { ordered: false });
                    updatedCount += result.modifiedCount || 0;
                }

                processedCount += users.length;
                lastProcessedId = users[users.length - 1]._id;
                
            }
        }

        // ---------- Summary ----------
        const summary = { totalProcessed: processedCount, updatedCount, errorCount };
        
        
        

        await mongoose.disconnect();
        return summary;
    } catch (error) {
        console.error('❌ Script failed:', error);
        await mongoose.disconnect();
        throw error;
    }
};

// -------- Parse CLI args --------
const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {
        dryRun: false,
        batchSize: 200,
        concurrency: 20,
        uhid: null,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--batch-size':
                options.batchSize = parseInt(args[++i], 10);
                break;
            case '--concurrency':
                options.concurrency = parseInt(args[++i], 10);
                break;
            default:
                options.uhid = args[i];
                break;
        }
    }
    return options;
};

// -------- Run if main --------
if (require.main === module) {
    const options = parseArgs();
    updateXRanks(options)
        .then(() => {
            
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Script failed:', error);
            process.exit(1);
        });
}

module.exports = { updateXRanks };
