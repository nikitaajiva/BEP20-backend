
const mongoose = require('mongoose');
const Ledger = require('../../models/Ledger');            // <-- adjust path if needed

/* 1.  Inline schema for communityboosterrewards collection           */
const communityBoosterRewardSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        triggeringUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
        triggeringEventId: { type: mongoose.Schema.Types.ObjectId, required: true },
        amount: { type: mongoose.Schema.Types.Decimal128, required: true },
        rate: { type: mongoose.Schema.Types.Decimal128, required: true },
        level: { type: Number, required: true },
        tier: { type: Number, required: true },
        isDoubleReward: { type: Boolean, default: false },
        narrative: { type: String },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
    },
    {
        collection: 'communityboosterrewards',   // exact collection name
        timestamps: true,
    }
);

const CommunityBoosterReward = mongoose.model(
    'CommunityBoosterReward',
    communityBoosterRewardSchema
);

const DRY_RUN = process.argv.includes('--dryrun');

/* 2.  Helpers                                                         */
async function connectDB() {
    const uri =
        process.env.TEST_DB_URI ||
        process.env.MONGODB_URI ||
        'mongodb://localhost:27017/xrpmigrate';

    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    
}

/* 3.  Migration                                                       */
async function addJuly5BoosterRewards() {
    await connectDB();

    // 2025-07-05 00:00 → 2025-07-06 00:00  (UTC)
    const start = new Date(Date.UTC(2025, 6, 5));
    const end = new Date(Date.UTC(2025, 6, 6));

    
    const perUser = await CommunityBoosterReward.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);

    

    for (const { _id: userId, total } of perUser) {
        const ledger = await Ledger.findOne({ userId });

        if (!ledger) {
            console.warn(`No ledger for user ${userId}`);
            continue;
        }

        const usedNow = ledger?.limits?.fiveXLimit?.used
            ? parseFloat(ledger.limits.fiveXLimit.used.toString())
            : 0;

        const increment = parseFloat(total.toString());
        const newUsed = usedNow + increment;
        if (DRY_RUN) {
            
            continue;                               // skip write
        }
        else {
            // Ensure nested paths exist
            ledger.limits ||= {};
            ledger.limits.fiveXLimit ||= {};
            ledger.limits.fiveXLimit.used = mongoose.Types.Decimal128.fromString(
                newUsed.toFixed(8)
            );

            await ledger.save();
            
        }
    }

    
    await mongoose.disconnect();
    
}

/* 4.  CLI runner                                                      */
if (require.main === module) {
    addJuly5BoosterRewards()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('Migration failed:', err);
            process.exit(1);
        });
}

module.exports = { addJuly5BoosterRewards };
