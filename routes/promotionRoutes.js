const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { protect } = require('../middleware/authMiddleware');

// @route   GET /api/promotions/airdrop-config
// @desc    Get the current airdrop promotion configuration
// @access  Private (user must be logged in)
router.get('/airdrop-config', protect, promotionController.getAirdropPromotionConfig);

module.exports = router; 
