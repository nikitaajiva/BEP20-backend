const cron = require("node-cron");
const { runDailyTscMining } = require("../services/miningService");

let miningCronTask = null;

function scheduleDailyTscMiningJob() {
  const enabled = process.env.TSC_MINING_CRON_ENABLED === "true";
  const schedule = process.env.TSC_MINING_CRON_SCHEDULE || "5 0 * * *";

  if (!enabled) {
    console.log("TSC daily mining cron is disabled.");
    return null;
  }

  if (miningCronTask) {
    return miningCronTask;
  }

  if (!cron.validate(schedule)) {
    console.error("Invalid cron expression for TSC Mining Job. Job not scheduled.");
    return null;
  }

  console.log(`Scheduling TSC daily mining cron with schedule: ${schedule}`);

  miningCronTask = cron.schedule(
    schedule,
    async () => {
      try {
        console.log("[Cron Job] Running TSC daily mining...");
        const result = await runDailyTscMining();
        console.log("[Cron Job] TSC daily mining completed:", JSON.stringify(result));
      } catch (error) {
        console.error("[Cron Job] Error in TSC daily mining:", error);
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  return miningCronTask;
}

module.exports = {
  scheduleDailyTscMiningJob,
};
