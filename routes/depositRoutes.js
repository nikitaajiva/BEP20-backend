const express = require('express');
const router = express.Router();
const { recordXrpDeposit, getDepositsHistory, recordDepositAddress } = require('../controllers/depositController');
const { protect,blockDuringCron } = require('../middleware/authMiddleware'); // Assuming you have auth middleware

// POST /api/deposits/xrp
// Route for user to record an XRP deposit they made to the system wallet.
// The controller will verify against XRPL and then queue for outbox processing.
router.post('/xrp', protect, blockDuringCron,recordXrpDeposit);

// GET /api/deposits/history
// Get deposit history for the authenticated user
router.get('/history', protect, getDepositsHistory);

router.post('/address', protect, recordDepositAddress);

// You can add other deposit-related routes here if needed in the future.

module.exports = router; 