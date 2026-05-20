const cron = require("node-cron");
const { runHorseNftPayouts } = require("../Modules/horseNft/Services/horseNftPayoutService");

let horseNftPayoutCronTask = null;

function scheduleHorseNftPayoutCron() {
  const featureEnabled = process.env.HORSE_NFT_ENABLED === "true";
  const cronEnabled = process.env.HORSE_NFT_PAYOUT_CRON_ENABLED === "true";
  const schedule = process.env.HORSE_NFT_PAYOUT_CRON_SCHEDULE || "10 0 * * *";

  if (!featureEnabled || !cronEnabled) {
    console.log("Horse NFT payout cron is disabled.");
    return null;
  }

  if (horseNftPayoutCronTask) {
    return horseNftPayoutCronTask;
  }

  if (!cron.validate(schedule)) {
    console.error("Invalid Horse NFT payout cron schedule. Job not started.");
    return null;
  }

  console.log(`Scheduling Horse NFT payout cron with schedule: ${schedule}`);

  horseNftPayoutCronTask = cron.schedule(
    schedule,
    async () => {
      try {
        console.log("[Horse NFT Cron] Starting payout run...");
        const result = await runHorseNftPayouts({
          dryRun: false,
          triggeredBy: "CRON",
        });
        console.log(
          "[Horse NFT Cron] Completed payout run:",
          JSON.stringify({
            eligibleCount: result.eligibleCount,
            processedCount: result.processedCount,
            skippedCount: result.skippedCount,
            failedCount: result.failedCount,
            totalPaidUSDT: result.totalPaidUSDT,
          })
        );
      } catch (error) {
        console.error("[Horse NFT Cron] Payout run failed:", error);
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  return horseNftPayoutCronTask;
}

module.exports = {
  scheduleHorseNftPayoutCron,
};
