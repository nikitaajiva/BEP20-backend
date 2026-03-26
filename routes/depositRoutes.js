const express = require('express');
const router = express.Router();
const {
  recordUsdtDeposit,
  recordBnbDeposit,
  getDepositsHistory,
  recordDepositAddress,
  createDepositIntent,
  getDepositIntent,
  verifyDepositIntent,
} = require('../controllers/depositController');
const { protect,blockDuringCron } = require('../middleware/authMiddleware'); // Assuming you have auth middleware

// POST /api/deposits/usdt
// Route for user to record a USDT deposit they made to the system wallet.
// The controller will verify against BSC and then queue for outbox processing.
router.post('/usdt', protect, blockDuringCron, recordUsdtDeposit);
router.post('/bnb', protect, blockDuringCron, recordBnbDeposit);

// GET /api/deposits/history
// Get deposit history for the authenticated user
router.get('/history', protect, getDepositsHistory);

router.post('/address', protect, recordDepositAddress);
router.post('/intent', protect, blockDuringCron, createDepositIntent);
router.get('/intent/:referenceId', protect, blockDuringCron, getDepositIntent);
router.get('/verify', protect, blockDuringCron, verifyDepositIntent);

// You can add other deposit-related routes here if needed in the future.

module.exports = router; 
