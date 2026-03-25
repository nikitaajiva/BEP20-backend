// scripts/clone_x1.js
//----------------------------------------------------
// Automatic datewise X1 reward repayer
// Usage:
//   node scripts/clone_x1.js --date=2025-12-04
//
// What it does:
// 1. Reads ALL X1 rewards on the given date
// 2. Groups them by user
// 3. Clones them for TODAY
// 4. Updates wallets.xBonus, wallets.communityRewards
// 5. Updates limits.fiveXLimit.used
// 6. Prints summary
//----------------------------------------------------

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
const X1Rewards = require("../models/X1Reward");
const Ledger = require("../models/Ledger");

const { Decimal128 } = mongoose.Types;

// ----------- READ DATE FROM COMMAND LINE ------------
const argDate = process.argv.find(a => a.startsWith("--date="));
if (!argDate) {
    console.log("❌ Missing --date=YYYY-MM-DD");
    process.exit(1);
}
const INPUT_DATE = argDate.split("=")[1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(INPUT_DATE)) {
    console.log("❌ Invalid date format. Use YYYY-MM-DD");
    process.exit(1);
}

// today's timestamp for cloned entries
const TODAY_TS = new Date();

// ----------------------------------------------------

async function run() {
    console.log("⏳ Connecting to MongoDB...");
    await connectDB();

    console.log(`📅 Searching all X1Rewards for date: ${INPUT_DATE}`);

    const start = new Date(`${INPUT_DATE}T00:00:00.000Z`);
    const end = new Date(`${INPUT_DATE}T23:59:59.999Z`);

    const rewards = await X1Rewards.find({
        ts: { $gte: start, $lte: end }
    });

    if (!rewards.length) {
        console.log("❌ No X1Rewards found for this date.");
        process.exit(0);
    }

    console.log(`🔍 Found ${rewards.length} X1Rewards for that date.`);

    // group by user
    const byUser = {};
    for (const r of rewards) {
        const uid = r.userId.toString();
        if (!byUser[uid]) byUser[uid] = [];
        byUser[uid].push(r);
    }

    console.log(`👤 Total users to update: ${Object.keys(byUser).length}`);

    const finalReport = [];

    // --------------------------------------------------
    // PROCESS EACH USER
    // --------------------------------------------------
    for (const userIdStr of Object.keys(byUser)) {
        const userId = new mongoose.Types.ObjectId(userIdStr);
        const userRewards = byUser[userIdStr];

        console.log(`\n➡️ Processing user: ${userIdStr}, rewards: ${userRewards.length}`);

        let cloneList = [];
        let sumUserRewards = 0;

        for (const r of userRewards) {

            if(r.depositorId && r.amount ){
            const amt = parseFloat(r.amount.toString());
            sumUserRewards += amt;

            cloneList.push({
               userId: r.userId,
                depositorId: r.depositorId,
                amount: r.amount,
                tier: r.tier,
                rate: r.rate,
                level: r.level,
                depositAmount: r.depositAmount,
                triggeringEventId: r.triggeringEventId,
                ts: TODAY_TS
            });
        }
        }

        // Insert cloned X1 rewards
        await X1Rewards.insertMany(cloneList);

        console.log(`   ✔ Cloned ${userRewards.length} → Total: ${sumUserRewards}`);

        // ------ UPDATE LEDGER FOR THIS USER ------
        const ledger = await Ledger.findOne({ userId });

        if (!ledger) {
            console.log("   ⚠️ Ledger not found for this user — skipping ledger update.");
            continue;
        }

        const xOld = parseFloat(ledger.wallets.xBonus.toString());
        const crOld = float(ledger.wallets.communityRewards.toString());
        const fxOld = float(ledger.limits.fiveXLimit.used.toString());

        // Update 3 values
        ledger.wallets.xBonus = Decimal128.fromString((xOld + sumUserRewards).toString());
        ledger.wallets.communityRewards = Decimal128.fromString((crOld + sumUserRewards).toString());
        ledger.limits.fiveXLimit.used = Decimal128.fromString((fxOld + sumUserRewards).toString());

        await ledger.save();

        finalReport.push({
            userId: userIdStr,
            rewardsCloned: userRewards.length,
            amountAdded: sumUserRewards,
            newFiveXUsed: ledger.limits.fiveXLimit.used.toString()
        });

        console.log("   💰 Ledger updated.");
    }

    console.log("\n========== DAILY CLONE SUMMARY ==========");
    console.table(finalReport);
    console.log("✅ All done!");

    process.exit(0);
}

// small helper
function float(v) {
    return parseFloat(v || 0);
}

run().catch(err => {
    console.error("❌ ERROR:", err);
    process.exit(1);
});
