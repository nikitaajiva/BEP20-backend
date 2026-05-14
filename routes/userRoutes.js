const express = require('express');
const router = express.Router();
const { updateNotificationSettings, updateWalletAddress, updateUserProfile, stakeTokens, purchaseNft } = require('../controllers/userController');
const { protect, blockDuringCron } = require('../middleware/authMiddleware');

// @route   PUT /api/users/profile
// @desc    Update a user's profile information
// @access  Private
router.put('/profile', protect, updateUserProfile);

// @route   PUT /api/users/settings/notifications
// @desc    Update a user's notification settings
// @access  Private
router.put('/settings/notifications', protect, updateNotificationSettings);

// @route   PUT /api/users/wallet-address
// @desc    Update a user's wallet address
// @access  Private
router.put('/wallet-address', protect,blockDuringCron, updateWalletAddress);

// @route   POST /api/users/stake
// @desc    Stake tokens
// @access  Private
router.post('/stake', protect, blockDuringCron, stakeTokens);

// @route   POST /api/users/purchase-nft
// @desc    Purchase NFT
// @access  Private
router.post('/purchase-nft', protect, blockDuringCron, purchaseNft);

module.exports = router; 
