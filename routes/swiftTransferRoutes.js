const express = require('express');
const router = express.Router();
const swiftTransferController = require('../controllers/swiftTransferController');
const authMiddleware = require('../middleware/authMiddleware');

// @route   POST /api/swift-transfers/transfer
// @desc    Transfer Swift balance to another user
// @access  Private
router.post('/transfer', authMiddleware.protect, swiftTransferController.transferToUser);

// @route   GET /api/swift-transfers/history
// @desc    Get Swift transfer history for the logged-in user
// @access  Private
router.get('/history', authMiddleware.protect, swiftTransferController.getSwiftTransfers);

module.exports = router; 