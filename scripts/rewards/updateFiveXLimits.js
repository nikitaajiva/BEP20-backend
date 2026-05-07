const mongoose = require('mongoose');
const X1Reward = require('../../models/X1Reward');
const Ledger = require('../../models/Ledger');

const connectDB = async () => {
    try {
        const dbURI = process.env.TEST_DB_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/xrpmigrate";
        await mongoose.connect(dbURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

async function updateFiveXLimits() {
    try {
        await connectDB();
        

        // Get all X1 rewards
        const rewards = await X1Reward.find({}).lean();
        

        // Group rewards by userId and calculate total
        const userTotals = {};
        rewards.forEach(reward => {
            const userId = reward.userId.toString();
            if (!userTotals[userId]) {
                userTotals[userId] = 0;
            }
            userTotals[userId] += parseFloat(reward.amount.toString());
        });

        

        // Update each user's ledger
        for (const [userId, total] of Object.entries(userTotals)) {
            const ledger = await Ledger.findOne({ userId: new mongoose.Types.ObjectId(userId) });
            
            if (ledger) {
                 
                // Convert to Decimal128
                     // Get current used value or default to 0
                     const currentUsed = ledger.limits.fiveXLimit.used ? parseFloat(ledger.limits.fiveXLimit.used.toString()) : 0;
                     // Add the new total to the current value
                     const newTotal = currentUsed + total;
                     // Convert to Decimal128
                     const newUsed = mongoose.Types.Decimal128.fromString(newTotal.toFixed(8));
                     
                // Update the fiveXLimit.used
                ledger.limits.fiveXLimit.used = newUsed;
                await ledger.save();
                
                
            } else {
                
            }
        }

        
    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        
    }
}

// If running this script directly
if (require.main === module) {
    updateFiveXLimits()
        .then(() => {
            
            process.exit(0);
        })
        .catch(error => {
            console.error('Script failed:', error);
            process.exit(1);
        });
}

module.exports = {
    updateFiveXLimits
}; 
