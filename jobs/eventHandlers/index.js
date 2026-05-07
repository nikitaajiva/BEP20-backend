const { handleLpDeposit } = require('./lpDepositHandler');
const { handleRefDeposit } = require('./refDepositHandler');
const { handleDailyRoiBatch } = require('./dailyRoiBatchHandler');
const { handleDailyRoiUser } = require('./dailyRoiUserHandler');
const { handleRoiCascade } = require('./roiCascadeHandler');
// Import other handlers here as they are created

module.exports = {
    handleLpDeposit,
    handleRefDeposit,
    handleDailyRoiBatch,
    handleDailyRoiUser,
    handleRoiCascade,
    // Add other handlers here
}; 
