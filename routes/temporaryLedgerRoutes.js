const express = require('express');
const router = express.Router();
const temporaryLedgerController = require('../controllers/temporaryLedgerController');

// GET /api/temp-ledger/apply-test-swift-balance?username=<username>&amount=<amount>
// Allows setting a test Swift balance for a user by username.
// Note: This is an unauthenticated route for testing/admin purposes.
router.get('/apply-test-swift-balance', temporaryLedgerController.applyTestSwiftBalance);

module.exports = router; 