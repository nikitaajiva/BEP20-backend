const mongoose = require('mongoose');
const User = require('../../models/User');
const Outbox = require('../../models/Outbox');

const BATCH_SIZE = process.env.ROI_USER_BATCH_SIZE || 5000; // Number of users to process in one go for enqueuing

exports.handleDailyRoiBatch = async (payload, session, event) => {
    console.log(`DAILY_ROI_BATCH Handler: Starting to enqueue DAILY_ROI_USER events. Batch ID: ${event._id}`);
    const { triggeredAt } = payload;

    let page = 0;
    let usersProcessed = 0;
    let hasMoreUsers = true;

    while (hasMoreUsers) {
        // Fetch a batch of users. We only need their _id.
        // Using .lean() for performance as we don't need full Mongoose documents here.
        const users = await User.find({}, '_id')
            .sort({ _id: 1 }) // Consistent ordering for pagination
            .skip(page * BATCH_SIZE)
            .limit(BATCH_SIZE)
            .lean()
            .session(session); // Important to use session if operations need to be part of the transaction
                                // However, enqueuing outbox events itself might not need to be in parent transaction
                                // if the batch job is just for kicking off individual user jobs.
                                // For simplicity now, keeping it in session. Consider if this is too long-running.

        if (users.length === 0) {
            hasMoreUsers = false;
            break;
        }

        const outboxEvents = users.map(user => ({
            eventType: 'DAILY_ROI_USER',
            payload: {
                userId: user._id,
                processingDate: triggeredAt || new Date().toISOString() // Date for which ROI is being calculated
            },
            status: 'PENDING',
            nextRunTs: new Date(), // Process ASAP
            // Optionally, link back to the batch event
            // parentBatchId: event._id 
        }));

        if (outboxEvents.length > 0) {
            // Bulk insert for efficiency, still within the transaction of the batch handler
            await Outbox.insertMany(outboxEvents, { session });
            console.log(`DAILY_ROI_BATCH Handler: Enqueued ${outboxEvents.length} DAILY_ROI_USER events (Page: ${page + 1}).`);
            usersProcessed += outboxEvents.length;
        } else {
            console.log(`DAILY_ROI_BATCH Handler: No users found in page ${page + 1} to enqueue.`);
        }

        if (users.length < BATCH_SIZE) {
            hasMoreUsers = false; // Last page
        }

        page++;
    }

    console.log(`DAILY_ROI_BATCH Handler: Finished enqueuing. Total ${usersProcessed} DAILY_ROI_USER events created.`);
    // The batch event itself (DAILY_ROI_BATCH) will be marked as DONE by the OutboxProcessor
}; 