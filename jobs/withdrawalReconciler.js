const cron = require('node-cron');
const reconcileWithdrawals = require('./reconcileWithdrawals');

// Run the reconcileWithdrawals job on a schedule
function start() {
  console.log('Withdrawal Reconciler scheduled to run every minute.');
  // "* * * * *" = every minute
  cron.schedule('* * * * *', async () => {
    try {
      await reconcileWithdrawals();
    } catch (err) {
      console.error('Error while running Withdrawal Reconciler job:', err);
    }
  });
}

module.exports = { start }; 