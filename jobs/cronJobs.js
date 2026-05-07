const cron = require('node-cron');
const Outbox = require('../models/Outbox');

// Schedule a task to run at 00:05 UTC every day
// Cron format: second minute hour day-of-month month day-of-week
// '5 0 * * *' means at 00:05:00 every day

function scheduleDailyRoiBatchJob() {
    if (process.env.DISABLE_CRON_JOBS === 'true') {
        
        return;
    }

    // Validate cron expression
    if (!cron.validate('5 0 * * *')) {
        console.error('Invalid cron expression for Daily ROI Batch Job. Job not scheduled.');
        return;
    }

    cron.schedule('5 0 * * *', async () => {
        
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
            
        } catch (error) {
            console.error('Error enqueuing DAILY_ROI_BATCH event:', error);
        }
    }, {
        scheduled: true,
        timezone: "UTC"
    });

    
}

module.exports = {
    scheduleDailyRoiBatchJob
}; 
