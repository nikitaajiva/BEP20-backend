const mongoose = require('mongoose');
const moment = require('moment');
const LedgerRow = require('../models/LedgerRow');
const DailyUserLp = require('../models/DailyUserLp');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

/**
 * Calculate daily LP for all users for a specific date
 * @param {Date} date - The date to calculate LP for
 */
const calculateDailyLPForDate = async (date) => {
    console.log(`Processing LP for date: ${moment(date).format('YYYY-MM-DD')}`);

    const startOfDay = moment(date).startOf('day').toDate();
    const endOfDay = moment(date).endOf('day').toDate();
    const previousDay = moment(date).subtract(1, 'day').startOf('day').toDate();

    // Get all LP deposits (walletTo: 'LP') and withdrawals (walletFrom: 'LP') for the day
    const lpTransactions = await LedgerRow.aggregate([
        {
            $match: {
                ts: { $gte: startOfDay, $lte: endOfDay },
                $or: [
                    { walletTo: 'LP' },   // Deposits into LP
                    { walletFrom: 'LP' }  // Withdrawals from LP
                ]
            }
        },
        {
            $group: {
                _id: '$userId',
                deposits: {
                    $sum: {
                        $cond: [
                            { $eq: ['$walletTo', 'LP'] },
                            { $toDouble: '$amount' },
                            0
                        ]
                    }
                },
                withdrawals: {
                    $sum: {
                        $cond: [
                            { $eq: ['$walletFrom', 'LP'] },
                            { $toDouble: '$amount' },
                            0
                        ]
                    }
                }
            }
        }
    ]);

    console.log(`Found ${lpTransactions.length} users with LP transactions`);

    // Process each user's LP
    for (const transaction of lpTransactions) {
        try {
            // Get previous day's LP
            const previousDayLP = await DailyUserLp.findOne({
                userId: transaction._id,
                date: previousDay
            }).lean();

            const previousLP = previousDayLP ? previousDayLP.lp : 0;
            const newLP = previousLP + transaction.deposits - transaction.withdrawals;

            // Update or create today's LP record
            await DailyUserLp.updateOne(
                {
                    userId: transaction._id,
                    date: startOfDay
                },
                {
                    $set: {
                        lp: newLP
                    }
                },
                { upsert: true }
            );

            console.log(`Updated LP for user ${transaction._id}: Previous LP ${previousLP}, Deposits ${transaction.deposits}, Withdrawals ${transaction.withdrawals}, New LP ${newLP}`);
        } catch (error) {
            console.error(`Error processing user ${transaction._id}:`, error);
        }
    }
};

/**
 * Calculate daily LP for all users within a date range
 * @param {Date} startDate - Start date of the range
 * @param {Date} endDate - End date of the range
 */
const calculateDailyLP = async (startDate, endDate) => {
    try {
        await connectDB();
        console.log(`Starting daily LP calculation from ${moment(startDate).format('YYYY-MM-DD')} to ${moment(endDate).format('YYYY-MM-DD')}`);

        // Process each day in the range
        let currentDate = moment(startDate);
        const lastDate = moment(endDate);

        while (currentDate <= lastDate) {
            await calculateDailyLPForDate(currentDate.toDate());
            currentDate.add(1, 'day');
        }

        console.log('Daily LP calculation completed for all dates');
        await mongoose.disconnect();
    } catch (error) {
        console.error('Script failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

// Parse command line arguments
const parseArgs = () => {
    const args = process.argv.slice(2);
    let startDate, endDate;

    if (args.length >= 2) {
        // If both dates provided
        startDate = moment(args[0], 'YYYY-MM-DD').startOf('day').toDate();
        endDate = moment(args[1], 'YYYY-MM-DD').startOf('day').toDate();
    } else if (args.length === 1) {
        // If only one date provided, use it as both start and end
        startDate = moment(args[0], 'YYYY-MM-DD').startOf('day').toDate();
        endDate = startDate;
    } else {
        // Default to yesterday
        startDate = moment().subtract(1, 'day').startOf('day').toDate();
        endDate = startDate;
    }

    return { startDate, endDate };
};

// If running this script directly
if (require.main === module) {
    const { startDate, endDate } = parseArgs();
    calculateDailyLP(startDate, endDate)
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
    calculateDailyLP
}; 