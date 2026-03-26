const config = {
  // Set to a past date to make the promotion active for development
  // Corresponds to Monday, January 1, 2024 12:00:00 AM UTC
  startTimestamp: 1749769230000
  , // Unix timestamp in milliseconds
  steps: [
    { durationHours: 72, percentage: 1.0 },  // Step 1: First 72 hours, 100%
    { durationHours: 72, percentage: 0.8 },  // Step 2: Next 72 hours, 80%
    { durationHours: 72, percentage: 0.6 },  // Step 3: Next 72 hours, 60%
    { durationHours: 72, percentage: 0.4 },  // Step 4: Next 72 hours, 40%
    { durationHours: 72, percentage: 1.0 },  // Step 5: Next 72 hours, 20%
  ],
};

module.exports = config; 