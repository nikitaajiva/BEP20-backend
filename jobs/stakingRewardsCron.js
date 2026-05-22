const cron = require("node-cron");
const TokenStaking = require("../models/TokenStaking");
const { distributeReferralRewards } = require("../services/referralRewardService");

/**
 * Staking Rewards Cron Job
 * Runs daily at 01:00 UTC.
 * For every active staking position whose lock-up has NOT expired:
 *   1. Computes the daily yield and adds it to `earnedRewards`.
 *   2. Distributes L1 (10%) and L2 (5%) referral rewards to sponsors automatically.
 */

let stakingCronTask = null;

function getApyForDays(days) {
  if (days >= 365) return 0.28;
  if (days >= 180) return 0.22;
  if (days >= 90)  return 0.12;
  return 0.10;
}

async function processStakingRewards() {
  const now = new Date();
  const todayDateStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  console.log(`[StakingRewardsCron] Starting daily staking reward distribution for ${todayDateStr}`);

  // Find all active staking positions whose endDate has not yet passed
  const activeStakes = await TokenStaking.find({
    status: "active",
    endDate: { $gt: now },
  });

  if (activeStakes.length === 0) {
    console.log("[StakingRewardsCron] No active staking positions found. Skipping.");
    return { processed: 0, totalCredited: 0 };
  }

  let processed = 0;
  let totalCredited = 0;

  for (const stake of activeStakes) {
    try {
      // Skip if purchased today (must wait until the next day after the purchase calendar date)
      const purchaseDateStr = new Date(stake.startDate || stake.createdAt).toISOString().slice(0, 10);
      if (purchaseDateStr === todayDateStr) {
        console.log(`[StakingRewardsCron] Skipping stake ${stake._id} purchased today (${purchaseDateStr})`);
        continue;
      }

      // Skip if already rewarded today
      if (stake.lastRewardedAt) {
        const lastRewardDate = new Date(stake.lastRewardedAt).toISOString().slice(0, 10);
        if (lastRewardDate === todayDateStr) {
          continue; // Already credited today
        }
      }

      const apy = stake.apy || getApyForDays(stake.days);
      const dailyYield = (stake.amount * apy) / 365;

      if (dailyYield <= 0) continue;

      // 1. Atomically increment earnedRewards and update lastRewardedAt
      await TokenStaking.updateOne(
        { _id: stake._id },
        {
          $inc: { earnedRewards: Number(dailyYield.toFixed(6)) },
          $set: { lastRewardedAt: now },
        }
      );

      processed++;
      totalCredited += dailyYield;

      // 2. Distribute L1 (10%) + L2 (5%) referral rewards to sponsors
      await distributeReferralRewards({
        earnerId:    stake.user,
        rewardUsdt:  dailyYield,
        refId:       stake._id.toString(),
        rewardType:  "STAKING",
        session:     null,
      });

    } catch (err) {
      console.error(`[StakingRewardsCron] Error processing stake ${stake._id}:`, err.message);
    }
  }

  // Also mark any expired stakes as completed
  const expiredResult = await TokenStaking.updateMany(
    { status: "active", endDate: { $lte: now } },
    { $set: { status: "completed" } }
  );

  if (expiredResult.modifiedCount > 0) {
    console.log(`[StakingRewardsCron] Marked ${expiredResult.modifiedCount} expired stakes as completed.`);
  }

  console.log(`[StakingRewardsCron] Done. Processed: ${processed}, Total credited: ${totalCredited.toFixed(6)} USDT`);
  return { processed, totalCredited };
}

function scheduleStakingRewardsCron() {
  if (process.env.DISABLE_CRON_JOBS === "true") {
    console.log("[StakingRewardsCron] Cron disabled via DISABLE_CRON_JOBS.");
    return null;
  }

  if (stakingCronTask) return stakingCronTask;

  const schedule = process.env.STAKING_REWARDS_CRON_SCHEDULE || "0 1 * * *"; // Default 01:00 UTC daily

  if (!cron.validate(schedule)) {
    console.error("[StakingRewardsCron] Invalid cron expression. Job not scheduled.");
    return null;
  }

  console.log(`[StakingRewardsCron] Scheduling with: ${schedule}`);

  stakingCronTask = cron.schedule(
    schedule,
    async () => {
      try {
        await processStakingRewards();
      } catch (error) {
        console.error("[StakingRewardsCron] Unhandled error:", error);
      }
    },
    { scheduled: true, timezone: "UTC" }
  );

  return stakingCronTask;
}

module.exports = {
  scheduleStakingRewardsCron,
  processStakingRewards, // Exported for manual trigger / testing
};
