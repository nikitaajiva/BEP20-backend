const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Decimal128 } = require('mongodb');
const connectDB = require("../../config/db");
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');

const { handleCommunityBooster } = require('../../jobs/eventHandlers/communityBoosterHandler');

/**
 * Script to distribute Community Booster rewards
 * This processes LP deposit events and distributes additional rewards to qualified uplines
 * based on their team volume and direct volume requirements.
 * 
 * Usage:
 * - Dry run: node distributeCommunityBooster.js --dry-run
 * - Live run: node distributeCommunityBooster.js
 * 
 * Options:
 * --dry-run: Show what would happen without making any changes
 * --from-date YYYY-MM-DD: Process events from this date (default: all unprocessed)
 * --to-date YYYY-MM-DD: Process events up to this date (default: now)
 */
// 

const distributeCommunityBooster = async (options = {}) => {
    const isDryRun = options.dryRun || false;
    const fromDate = options.fromDate ? new Date(options.fromDate) : null;
    const toDate = options.toDate ? new Date(options.toDate) : null;

    console.log(`Running in ${isDryRun ? 'DRY RUN' : 'LIVE'} mode, `);
    if (fromDate) console.log(`From date: ${fromDate.toISOString()}`);
    if (toDate) console.log(`To date: ${toDate.toISOString()}`);

    await connectDB();
    console.log('Starting COMMUNITY BOOSTER reward distribution script...');


    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(today.getUTCDate() - 1);
    
    // Find LP deposits that have not been processed for community booster yet
    const query = {
        eventType: 'DAILY_REWARDS_LP',

         ts: {
                $gte: tomorrow,
                $lt: today
              },
        $or: [
            { communityBoosterProcessed: { $exists: false } },
            { communityBoosterProcessed: false }
        ]
    };

    // Add date filters if specified
    if (fromDate || toDate) {
        query.ts = {};
        if (fromDate) query.ts.$gte = fromDate;
        if (toDate) query.ts.$lte = toDate;
    }

    const lpDepositEvents = await LedgerRow.find(query)
        .sort({ ts: 1 }) // Process oldest first
        .lean();

    console.log(`Found ${lpDepositEvents.length} unprocessed LP rewards to analyze for Community Booster rewards.`);

    let processedCount = 0;
    let errorCount = 0;
    let qualifiedCount = 0;
    let totalRewardsAmount = 0;

    for (const event of lpDepositEvents) {
        try {
           // console.log(`\n--- Processing event ${event._id} from ${event.ts}`);
            //console.log(`User: ${event.userId}, Amount: ${event.amount}, TxHash: ${event.refId}`);
            //console.log(`Processing event ${event._id} from ${event.ts} with userId ${event.userId}`);
            // if (event.userId ===  ObjectId('68416df05d8deee438fae10a') || event.userId === '68416df05d8deee438fae10a') {
            // }
       //     console.log(`Processing event  userId ${event.userId}`);

            const payload = {
                depositorUserId: event.userId,
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString()
            };

        if (!isDryRun) {
                console.log(`Processing event ${event._id} from ${event.ts} with userId ${event.userId}`);

                // =================================================
                // 🔒 5× CAP CHECK — COMMUNITY BOOSTER
                // =================================================
                const ledger = await Ledger.findOne(
                    { userId: event.userId },
                    {
                        "limits.fiveXLimit.cap": 1,
                        "limits.fiveXLimit.used": 1,
                        "wallets.lp": 1,
                    }
                ).lean();

                const cap = Number(ledger?.limits?.fiveXLimit?.cap || 0);
                const used = Number(ledger?.limits?.fiveXLimit?.used || 0);
                const remaining5x = cap - used;

                // ❌ USER HAS NO 5× CAP LEFT — SKIP BOOSTER
                if (remaining5x <= 0) {
                    await LedgerRow.updateOne(
                        { _id: event._id },
                        { $set: { communityBoosterProcessed: true } }
                    );

                    processedCount++;
                    continue; // ⛔ NO handleCommunityBooster()
                }

                // ✅ SAFE TO DISTRIBUTE BOOSTER
                await handleCommunityBooster(payload);

                // Mark this event as processed
                await LedgerRow.updateOne(
                    { _id: event._id },
                    { $set: { communityBoosterProcessed: true } }
                );

                processedCount++;
            } else {
                // In dry run, just simulate the processing
           //     console.log('DRY RUN - Would process this event:');
                console.log(JSON.stringify(payload, null, 2));
            }

        } catch (error) {
            errorCount++;
            console.error(`Failed to process event ${event._id}:`, error);
        }
    }

    const summary = {
        totalEvents: lpDepositEvents.length,
        processedCount,
        errorCount,
        qualifiedCount,
        totalRewardsAmount
    };

    console.log('\nProcessing Summary:');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nCOMMUNITY BOOSTER distribution script finished in ${isDryRun ? 'DRY RUN' : 'LIVE'} mode.`);
    
    await mongoose.disconnect();
    return summary;
};

// Parse command line arguments
const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {
        dryRun: false,
        fromDate: null,
        toDate: null
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--from-date':
                options.fromDate = args[++i];
                break;
            case '--to-date':
                options.toDate = args[++i];
                break;
        }
    }

    return options;
};

// If running this script directly
if (require.main === module) {
    const options = parseArgs();
    distributeCommunityBooster(options)
        .then(() => {
            console.log('Script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Script failed:', error);
            process.exit(1);
        });
}

module.exports = {
    distributeCommunityBooster
}; 