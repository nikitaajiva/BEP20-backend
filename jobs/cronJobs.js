const cron = require("node-cron");
const Outbox = require("../models/Outbox");

const DAILY_ROI_CRON_EXPRESSION = "5 0 * * *";
const DAILY_ROI_HOUR_UTC = 0;
const DAILY_ROI_MINUTE_UTC = 5;
let dailyRoiCronTask = null;

function getUtcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function enqueueDailyRoiBatch(triggeredAt = new Date()) {
  const processingDate = getUtcDateKey(triggeredAt);
  const existingBatch = await Outbox.findOne({
    eventType: "DAILY_ROI_BATCH",
    "payload.processingDate": processingDate,
  }).lean();

  if (existingBatch) {
    return existingBatch;
  }

  const outboxEvent = new Outbox({
    eventType: "DAILY_ROI_BATCH",
    payload: {
      triggeredAt: triggeredAt.toISOString(),
      processingDate,
      notes: "Daily ROI processing batch for all users.",
    },
    status: "PENDING",
    nextRunTs: new Date(),
  });

  await outboxEvent.save();
  return outboxEvent;
}

function hasPassedDailyRoiWindow(date = new Date()) {
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();

  return (
    hour > DAILY_ROI_HOUR_UTC ||
    (hour === DAILY_ROI_HOUR_UTC && minute >= DAILY_ROI_MINUTE_UTC)
  );
}

async function enqueueMissedDailyRoiBatchIfNeeded(now = new Date()) {
  if (process.env.DISABLE_CRON_JOBS === "true") {
    return null;
  }

  if (!hasPassedDailyRoiWindow(now)) {
    return null;
  }

  return enqueueDailyRoiBatch(now);
}

// Schedule a task to run at 00:05 UTC every day
// Cron format: second minute hour day-of-month month day-of-week
// '5 0 * * *' means at 00:05:00 every day

function scheduleDailyRoiBatchJob() {
  if (process.env.DISABLE_CRON_JOBS === "true") {
    return null;
  }

  if (dailyRoiCronTask) {
    return dailyRoiCronTask;
  }

  if (!cron.validate(DAILY_ROI_CRON_EXPRESSION)) {
    console.error(
      "Invalid cron expression for Daily ROI Batch Job. Job not scheduled."
    );
    return null;
  }

  dailyRoiCronTask = cron.schedule(
    DAILY_ROI_CRON_EXPRESSION,
    async () => {
      try {
        await enqueueDailyRoiBatch(new Date());
      } catch (error) {
        console.error("Error enqueuing DAILY_ROI_BATCH event:", error);
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
    }
  );

  return dailyRoiCronTask;
}

module.exports = {
  enqueueDailyRoiBatch,
  enqueueMissedDailyRoiBatchIfNeeded,
  scheduleDailyRoiBatchJob,
};
