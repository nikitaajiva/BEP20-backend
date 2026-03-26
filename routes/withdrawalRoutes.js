const express = require('express');
const router = express.Router();
const { withdrawUSDT, getWithdrawalsHistory, getWithdrawalDisabled, redeemhk, getTodayEventRewards } = require('../controllers/withdrawalController');
const { protect,blockDuringCron } = require('../middleware/authMiddleware');

// POST /api/withdrawals/usdt
// Process a USDT withdrawal request
router.post('/usdt', protect, blockDuringCron, withdrawUSDT);


router.post('/redeem', protect, blockDuringCron, redeemhk);
// GET /api/withdrawals/history
// Get withdrawal history for the authenticated user
router.get('/history', protect, getWithdrawalsHistory);

router.get('/MACAU_HK_EVENT', protect, getTodayEventRewards);

// GET /api/withdrawals/disabled
// Check if withdrawals are currently disabled for the authenticated user
router.get('/disabled', protect, getWithdrawalDisabled);

module.exports = router; 
