const mongoose = require('mongoose');

const OutboxSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'LP_DEPOSIT',         // User has made an LP deposit, needs processing
      'REF_DEPOSIT',        // A referral has deposited, sponsor needs bonus
      'DAILY_ROI_BATCH',    // Trigger to start processing daily ROI for all users
      'DAILY_ROI_USER',     // Process daily ROI for a specific user
      'ROI_CASCADE',        // Process ROI cascade for a specific user and their upline
      'AIRDROP_EXPIRY_CHECK' // Check if an airdrop needs to be burned or can be transferred
      // Add other event types as needed by the job worker system
    ],
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed, // Flexible payload depending on the event type
    required: true
  },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'RETRY'],
    default: 'PENDING',
    index: true
  },
  tryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 5 // Default max retries, can be overridden by specific event handlers
  },
  nextRunTs: { // Timestamp for when this event should be processed next
    type: Date,
    default: Date.now,
    index: true
  },
  lastAttemptTs: {
    type: Date
  },
  processingNodeId: { // ID of the worker node currently processing this event (for distributed systems)
    type: String,
    index: true,
    sparse: true // Index only if the field exists
  },
  errorDetails: [
    {
      timestamp: { type: Date, default: Date.now },
      message: String,
      stack: String
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Outbox', OutboxSchema); 