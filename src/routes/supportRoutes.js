const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { authenticateToken, authorizeSupport } = require('../middleware/auth');

// Get user balances
router.get('/user-balances/:userId', authenticateToken, authorizeSupport, supportController.getUserBalances);

// Return deposit
router.post('/return-deposit', authenticateToken, authorizeSupport, supportController.returnDeposit);

module.exports = router; 