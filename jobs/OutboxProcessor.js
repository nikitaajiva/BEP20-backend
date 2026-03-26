const mongoose = require('mongoose');
const Outbox = require('../models/Outbox');

// Placeholder for actual event handlers
const eventHandlers = {
    // LP_DEPOSIT: async (payload, session) => { console.log('Processing LP_DEPOSIT:', payload); },
    // REF_DEPOSIT: async (payload, session) => { console.log('Processing REF_DEPOSIT:', payload); },
    // DAILY_ROI_USER: async (payload, session) => { console.log('Processing DAILY_ROI_USER:', payload); },
    // ROI_CASCADE: async (payload, session) => { console.log('Processing ROI_CASCADE:', payload); },
    // AIRDROP_EXPIRY_CHECK: async (payload, session) => { console.log('Processing AIRDROP_EXPIRY_CHECK:', payload); }
};

class OutboxProcessor {
    constructor(pollInterval = 5000, batchSize = 10, maxRetries = 5) {
        this.pollInterval = pollInterval; // Time in ms between polls
        this.batchSize = batchSize;       // Number of events to fetch per poll
        this.maxRetries = maxRetries;     // Default max retries for an event
        this.isPolling = false;
        this.timeoutId = null;
    }

    registerHandler(eventType, handler) {
        eventHandlers[eventType] = handler;
        console.log(`Handler registered for ${eventType}`);
    }

    async processEvent(event, session) {
        const handler = eventHandlers[event.eventType];
        if (!handler) {
            throw new Error(`No handler registered for event type: ${event.eventType}`);
        }
        // Actual event processing logic by the specific handler, executed within the session
        await handler(event.payload, session, event);
    }

    async run() {
        if (this.isPolling) return;
        this.isPolling = true;

        // console.log('OutboxProcessor: Polling for events...');

        const eventsToProcess = await Outbox.find({
            status: { $in: ['PENDING', 'RETRY'] },
            nextRunTs: { $lte: new Date() }
        })
        .sort({ nextRunTs: 1 }) // Process older events first
        .limit(this.batchSize);

        if (eventsToProcess.length > 0) {
            console.log(`OutboxProcessor: Found ${eventsToProcess.length} event(s) to process.`);
        }

        for (const event of eventsToProcess) {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    // Mark as PROCESSING
                    event.status = 'PROCESSING';
                    event.lastAttemptTs = new Date();
                    await event.save({ session });

                    console.log(`OutboxProcessor: Processing event ${event._id} of type ${event.eventType}`);
                    await this.processEvent(event, session);

                    event.status = 'DONE';
                    await event.save({ session });
                    console.log(`OutboxProcessor: Event ${event._id} processed successfully.`);
                });
            } catch (error) {
                console.error(`OutboxProcessor: Error processing event ${event._id}:`, error.message);
                event.tryCount += 1;
                event.errorDetails.push({ message: error.message, stack: error.stack, timestamp: new Date() });
                
                if (event.tryCount >= (event.maxRetries || this.maxRetries)) {
                    event.status = 'FAILED';
                    console.error(`OutboxProcessor: Event ${event._id} failed after ${event.tryCount} retries.`);
                } else {
                    event.status = 'RETRY';
                    // Exponential backoff for retries, e.g., 1m, 2m, 4m, 8m, 16m for 5 retries
                    const retryDelay = Math.pow(2, event.tryCount -1 ) * 60 * 1000; // in milliseconds
                    event.nextRunTs = new Date(Date.now() + retryDelay);
                    console.log(`OutboxProcessor: Event ${event._id} scheduled for retry at ${event.nextRunTs}. Attempt ${event.tryCount}`);
                }
                await event.save(); // Save outside transaction as the transaction would have aborted
            } finally {
                await session.endSession();
            }
        }

        this.isPolling = false;
        if (this.timeoutId) clearTimeout(this.timeoutId); // Clear previous timeout if any
        this.timeoutId = setTimeout(() => this.run(), this.pollInterval);
    }

    start() {
        console.log('OutboxProcessor: Starting polling...');
        // Check MONGODB_URI before starting
        if (!process.env.MONGODB_URI) {
            console.error('OutboxProcessor: MONGODB_URI is not defined. Worker cannot start.');
            return;
        }
        // Initial run, then setInterval will take over
        this.run();
    }

    stop() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            console.log('OutboxProcessor: Polling stopped.');
        }
        this.isPolling = false; // Ensure it stops trying to poll
    }
}

async function processOutboxEvent(event) {
    console.log(`Processing event: ${event._id}, type: ${event.eventType}`);
    let handler;
    // Note: Handlers are now passed in the processQueue call
    
    try {
        if (!eventHandlers[event.eventType]) {
            throw new Error(`No handler registered for event type: ${event.eventType}`);
        }
        handler = eventHandlers[event.eventType];
        
        await handler(event.payload, null, event); // Pass null for session
        
        event.status = 'processed';
        event.processedAt = new Date();
        event.attempts += 1;
        await event.save();
        
    } catch (error) {
        console.error(`Error processing event ${event._id}:`, error);
        event.status = 'failed';
        event.lastAttemptAt = new Date();
        event.attempts += 1;
        event.error = {
            message: error.message,
            stack: error.stack,
            handler: handler ? handler.name : 'N/A'
        };
        await event.save();
    }
}

async function processQueue() {
    // ... existing code ...
}

module.exports = OutboxProcessor; 