const mongoose = require('mongoose');
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const moment = require('moment');


const createDailyLpSnapshot = async () => {
    try {
        
        
        // Get today's date at midnight
        const today = moment().startOf('day').toDate();
        
        // Create the aggregation pipeline
        const pipeline = [
            // Match ledgers with LP > 0
            {
                $match: {
                    "wallets.lp": { $gt: 0 }
                }
            },
            // Lookup user details
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "user"
                }
            },
            // Unwind the user array from lookup
            {
                $unwind: "$user"
            },
            // Project the required fields
            {
                $project: {
                    _id: 0,
                    userId: "$_id",
                    username: "$user.username",
                    uhid: "$user.uhid",
                    date: today,
                    lp: { $toDouble: "$wallets.lp" }
                }
            },
            // Merge into dailyuserlps collection
            {
                $merge: {
                    into: "dailyuserlps",
                    on: ["userId", "date"],
                    whenMatched: "replace",
                    whenNotMatched: "insert"
                }
            }
        ];

        // Execute the aggregation
        const result = await mongoose.connection.db.collection('ledgers').aggregate(pipeline).toArray();
        
        // Get the count of records created/updated
        const recordCount = await mongoose.connection.db
            .collection('dailyuserlps')
            .countDocuments({ date: today });

        

        return recordCount;
    } catch (error) {
        console.error('Error creating daily LP snapshot:', error);
        throw error;
    }
};

const run = async () => {
    try {
        await connectDB();
        await createDailyLpSnapshot();
        await mongoose.disconnect();
        
        process.exit(0);
    } catch (error) {
        console.error('Script failed:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

// Run the script
run(); 
