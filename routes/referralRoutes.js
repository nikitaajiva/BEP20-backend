const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { TIER_REWARDS } = require('../utils/rewardsUtils');

// @route   GET /api/referrals/direct-children
// @desc    Get authenticated user's direct children with USDT reward contribution
// @access  Private
router.get('/direct-children', protect, async (req, res) => {
  try {
    const parentId = req.user._id;
    const children = await User.find({ sponsorId: parentId })
      .select('_id username email level directDownlines communitySize height')
      .lean();

    const childrenWithRewards = children.map(child => ({
      ...child,
      usdtRewardContribution: 5
    }));

    res.json({
      success: true,
      count: childrenWithRewards.length,
      data: childrenWithRewards
    });
  } catch (err) {
    console.error('Error fetching direct children:', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching direct children' });
  }
});

// @route   GET /api/referrals/direct-children-count
// @desc    Get count of authenticated user's direct children
// @access  Private
router.get('/direct-children-count', protect, async (req, res) => {
  try {
    const parentId = req.user._id;
    const directCount = await User.countDocuments({ sponsorId: parentId });

    res.json({
      success: true,
      directDownlines: directCount
    });
  } catch (err) {
    console.error('Error fetching direct children count:', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching direct children count' });
  }
});

// @route   GET /api/referrals/tiered-children
// @desc    Get children at a specific tier relative to the authenticated user
// @access  Private
router.get('/tiered-children', protect, async (req, res) => {
  try {
    const sponsor = req.user;
    const requestedTierString = req.query.tier;

    if (!requestedTierString || isNaN(parseInt(requestedTierString, 10)) || parseInt(requestedTierString, 10) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid or missing "tier" query parameter. Must be a positive integer.' });
    }
    const requestedTier = parseInt(requestedTierString, 10);

    const targetAbsoluteLevel = sponsor.level + requestedTier;
    
    const query = {
      level: targetAbsoluteLevel,
      [`path.${sponsor.level}`]: sponsor._id 
    };

    const tieredChildren = await User.find(query)
      .select('_id username email level country countryCode whatsappContact balanceUSDT directDownlines communitySize height')
      .lean();

    const childrenWithRewards = tieredChildren.map(child => ({
      ...child,
      usdtRewardContribution: TIER_REWARDS[requestedTier] !== undefined ? TIER_REWARDS[requestedTier] : 0
    }));

    res.json({
      success: true,
      requestedTier,
      sponsorDetails: {
        id: sponsor._id,
        username: sponsor.username,
        level: sponsor.level
      },
      calculatedTargetAbsoluteLevel: targetAbsoluteLevel,
      count: childrenWithRewards.length,
      data: childrenWithRewards
    });

  } catch (err) {
    console.error(`Error fetching Tier ${req.query.tier} children for sponsor ${req.user._id}:`, err.message, err.stack);
    res.status(500).json({ success: false, message: 'Server error fetching tiered children' });
  }
});

router.get('/', (req, res) => {
    res.send('Referral API endpoint placeholder. Configure your actual routes.');
});

module.exports = router; 
