const express = require('express');
const router = express.Router();
const { updateNotificationSettings, updateWalletAddress, updateUserProfile } = require('../controllers/userController');
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

module.exports = router; 
