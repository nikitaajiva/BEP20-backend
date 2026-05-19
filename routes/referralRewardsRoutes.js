const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getReferralRewardsSummary,
  getMyReferralTree,
} = require('../controllers/referralRewardsController');

// @route   GET /api/referral-rewards/summary
// @desc    Get authenticated user's L1 + L2 TSC token referral earnings
// @access  Private
router.get('/summary', protect, getReferralRewardsSummary);

// @route   GET /api/referral-rewards/my-tree
// @desc    Get authenticated user's personal referral tree (L1 + L2 nodes)
// @access  Private
router.get('/my-tree', protect, getMyReferralTree);

module.exports = router;
