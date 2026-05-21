require("dotenv").config({ path: "../.env" }); // Support running from scripts directory
const mongoose = require("mongoose");
const User = require("../models/User");
const TokenStaking = require("../models/TokenStaking");

/**
 * Migration Script
 * Migrates legacy nested stakingPlans from User documents into the dedicated TokenStaking collection.
 */

async function migrateStakingData() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Error: MONGODB_URI is not set in environment variables.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected successfully.");

  try {
    const users = await User.find({
      $or: [
        { "stakingPlans.0": { $exists: true } },
        { "stakingPlan.amount": { $exists: true } }
      ]
    });

    console.log(`Found ${users.length} users with potential legacy staking data.`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // 1. Gather all legacy staking plans
      const legacyPlans = [
        ...(user.stakingPlan?.amount ? [{ ...user.stakingPlan.toObject(), isPrimary: true }] : []),
        ...(user.stakingPlans || [])
      ];

      for (const plan of legacyPlans) {
        if (!plan.amount || Number(plan.amount) <= 0) continue;

        const startDate = plan.startDate || new Date();
        const days = plan.days || 365;
        const endDate = plan.endDate || new Date(new Date(startDate).getTime() + (days * 86400000));
        
        // Compute APY
        let apy = plan.apy;
        if (apy === undefined) {
          apy = days >= 365 ? 0.28 : days >= 180 ? 0.22 : days >= 90 ? 0.12 : 0.10;
        } else if (apy > 1) {
          apy = apy / 100; // Normalise percentage to decimal format
        }

        // Check if this plan is already migrated to prevent duplicates
        const existingStake = await TokenStaking.findOne({
          user: user._id,
          amount: Number(plan.amount),
          days: Number(days),
          startDate: new Date(startDate)
        });

        if (existingStake) {
          skippedCount++;
          continue;
        }

        // Calculate earned rewards so far
        const daysPassed = Math.max(0, Math.floor((new Date() - new Date(startDate)) / 86400000));
        const dailyYield = (Number(plan.amount) * apy) / 365;
        const earnedRewards = Math.min(
          Number(plan.amount) * apy * (days / 365), // cap at max reward
          dailyYield * daysPassed
        );

        // Create the new dedicated TokenStaking document
        await TokenStaking.create({
          user: user._id,
          amount: Number(plan.amount),
          days: Number(days),
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          status: plan.status || (new Date() > new Date(endDate) ? "completed" : "active"),
          apy: Number(apy.toFixed(4)),
          tokenAmount: Number(plan.tokenAmount || plan.tscAmount || 0),
          earnedRewards: Number(earnedRewards.toFixed(6)),
          lastRewardedAt: new Date(),
        });

        migratedCount++;
      }
    }

    console.log(`Migration Complete:`);
    console.log(`- Staking documents created: ${migratedCount}`);
    console.log(`- Already migrated / duplicates skipped: ${skippedCount}`);

  } catch (error) {
    console.error("Migration failed with error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

migrateStakingData().catch(console.error);
