const cron = require('node-cron');
const Outbox = require('../models/Outbox');

// Schedule a task to run at 00:05 UTC every day
// Cron format: second minute hour day-of-month month day-of-week
// '5 0 * * *' means at 00:05:00 every day

function scheduleDailyRoiBatchJob() {
    if (process.env.DISABLE_CRON_JOBS === 'true') {
        console.log('Cron jobs are disabled via DISABLE_CRON_JOBS env variable.');
        return;
    }

    // Validate cron expression
    if (!cron.validate('5 0 * * *')) {
        console.error('Invalid cron expression for Daily ROI Batch Job. Job not scheduled.');
        return;
    }

    cron.schedule('5 0 * * *', async () => {
        console.log('Cron job triggered: Enqueuing DAILY_ROI_BATCH at', new Date().toISOString());
        try {
            const outboxEvent = new Outbox({
                eventType: 'DAILY_ROI_BATCH',
                payload: {
                    triggeredAt: new Date().toISOString(),
                    notes: 'Daily ROI processing batch for all users.'
                },
                status: 'PENDING',
                nextRunTs: new Date() // Process ASAP
            });
            await outboxEvent.save();
            console.log(`DAILY_ROI_BATCH event enqueued with ID: ${outboxEvent._id}`);
        } catch (error) {
            console.error('Error enqueuing DAILY_ROI_BATCH event:', error);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });

    console.log('Daily ROI Batch Job scheduled to run at 00:05 UTC every day.');
}

module.exports = {
    scheduleDailyRoiBatchJob
}; 