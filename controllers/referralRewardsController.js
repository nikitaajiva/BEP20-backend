const mongoose = require('mongoose');
const User = require('../models/User');
const LedgerRow = require('../models/LedgerRow');
const ProtocolConfig = require('../models/ProtocolConfig');

/**
 * Helper: safely convert Decimal128 / string / number → float
 */
const toFloat = (v) => {
  if (v == null) return 0;
  if (typeof v === 'object' && v.constructor?.name === 'Decimal128') {
    return parseFloat(v.toString()) || 0;
  }
  return parseFloat(v) || 0;
};

/**
 * GET /api/referral-rewards/summary
 * Returns L1 + L2 TSC token earnings for the authenticated user.
 *
 * L1 = users whose sponsorId === req.user._id  (direct)
 * L2 = users whose sponsor's sponsorId === req.user._id  (indirect)
 *
 * "Earnings" = tscAmount from NFT_PURCHASE LedgerRow rows where the
 *              triggeringUser (minter) is L1 or L2 of the current user.
 *
 * The referral reward is stored as a LedgerRow with:
 *   - eventType: 'NFT_PURCHASE'  (the reward credit row for the referrer)
 *   - userId: referrer's _id
 *   - narrative contains 'L1 referral' or 'L2 referral'
 *
 * If you store referral rewards differently, adjust the query below.
 */
const getReferralRewardsSummary = async (req, res) => {
  try {
    const currentUser = req.user;

    // ── 1. Fetch L1 users (direct referrals) ────────────────────────────────
    const l1Users = await User.find({ sponsorId: currentUser._id })
      .select('_id username uhid')
      .lean();
    const l1Ids = l1Users.map((u) => u._id);

    // ── 2. Fetch L2 users (referrals of L1 users) ───────────────────────────
    const l2Users =
      l1Ids.length > 0
        ? await User.find({ sponsorId: { $in: l1Ids } })
            .select('_id username uhid sponsorId')
            .lean()
        : [];
    const l2Ids = l2Users.map((u) => u._id);

    // ── 3. Get protocol config for rates ────────────────────────────────────
    const config = await ProtocolConfig.findOne({ key: 'default' }).lean();
    const l1Rate = toFloat(config?.referralLevel1Percent) || 10; // default 10%
    const l2Rate = toFloat(config?.referralLevel2Percent) || 5;  // default 5%

    // ── 4. Aggregate L1 referral reward rows from LedgerRow ─────────────────
    // These are rows credited TO the current user for L1 mints.
    // We look for NFT_PURCHASE rows where userId = currentUser AND refId matches an L1 user
    // OR the narrative contains an L1 reference.
    //
    // Strategy: sum all tscAmount rows where:
    //   userId = currentUser._id AND eventType includes NFT_PURCHASE-related referral events
    //   AND the refId (the minter) is in l1Ids or l2Ids
    //
    // Since the project may store these under different eventTypes, we check both
    // NFT_PURCHASE and BOOST_BONUS (which was used for referral bonuses in older code).
    // We differentiate L1 vs L2 via refId matching.

    const referralEventTypes = ['NFT_PURCHASE', 'BOOST_BONUS', 'ROI_CASCADE'];

    // L1 aggregate
    let l1TokenEarnings = 0;
    let l1TxCount = 0;

    if (l1Ids.length > 0) {
      const l1IdStrings = l1Ids.map(id => id.toString());
      const l1Agg = await LedgerRow.aggregate([
        {
          $match: {
            userId: currentUser._id,
            eventType: { $in: referralEventTypes },
            refId: { $in: l1IdStrings },
          },
        },
        {
          $group: {
            _id: null,
            totalTsc: { 
              $sum: { 
                $convert: { input: '$tscAmount', to: 'double', onError: 0, onNull: 0 } 
              } 
            },
            count: { $sum: 1 },
          },
        },
      ]);

      if (l1Agg.length > 0) {
        l1TokenEarnings = l1Agg[0].totalTsc || 0;
        l1TxCount = l1Agg[0].count || 0;
      }
    }

    // L2 aggregate
    let l2TokenEarnings = 0;
    let l2TxCount = 0;

    if (l2Ids.length > 0) {
      const l2IdStrings = l2Ids.map(id => id.toString());
      const l2Agg = await LedgerRow.aggregate([
        {
          $match: {
            userId: currentUser._id,
            eventType: { $in: referralEventTypes },
            refId: { $in: l2IdStrings },
          },
        },
        {
          $group: {
            _id: null,
            totalTsc: { 
              $sum: { 
                $convert: { input: '$tscAmount', to: 'double', onError: 0, onNull: 0 } 
              } 
            },
            count: { $sum: 1 },
          },
        },
      ]);

      if (l2Agg.length > 0) {
        l2TokenEarnings = l2Agg[0].totalTsc || 0;
        l2TxCount = l2Agg[0].count || 0;
      }
    }

    const totalTokenEarnings = l1TokenEarnings + l2TokenEarnings;

    return res.json({
      success: true,
      data: {
        l1: {
          count: l1Users.length,
          tokenEarnings: parseFloat(l1TokenEarnings.toFixed(6)),
          transactionCount: l1TxCount,
          ratePercent: l1Rate,
        },
        l2: {
          count: l2Users.length,
          tokenEarnings: parseFloat(l2TokenEarnings.toFixed(6)),
          transactionCount: l2TxCount,
          ratePercent: l2Rate,
        },
        totalTokenEarnings: parseFloat(totalTokenEarnings.toFixed(6)),
      },
    });
  } catch (err) {
    console.error('[referralRewards] getReferralRewardsSummary error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching referral rewards summary.' });
  }
};

/**
 * GET /api/referral-rewards/my-tree
 * Returns the authenticated user's personal downline tree (L1 + L2 nodes).
 *
 * Query params:
 *   depth  – how many levels to return (default 2, max 2 for now)
 */
const getMyReferralTree = async (req, res) => {
  try {
    const currentUser = req.user;

    const l1Users = await User.find({ sponsorId: currentUser._id })
      .select('_id username uhid email joiningTimeStamp registrationTs communitySize directDownlines stakingPlan stakingPlans nftPackages sponsorId xRank nodeTier positioningRank whatsappContact country countryCode')
      .lean();

    if (l1Users.length === 0) {
      return res.json({
        success: true,
        rootUser: { _id: currentUser._id, username: currentUser.username, uhid: currentUser.uhid },
        l1Count: 0, l2Count: 0, tree: []
      });
    }

    // Iteratively fetch down to 4 levels for a nice visual tree
    let allNodes = [...l1Users];
    let currentLevelIds = l1Users.map(u => u._id);
    let l2Count = 0;

    for (let depth = 2; depth <= 5; depth++) {
      if (currentLevelIds.length === 0) break;
      const children = await User.find({ sponsorId: { $in: currentLevelIds } })
        .select('_id username uhid email joiningTimeStamp registrationTs communitySize directDownlines stakingPlan stakingPlans nftPackages sponsorId xRank nodeTier positioningRank whatsappContact country countryCode')
        .lean();
      
      if (depth === 2) l2Count = children.length;
      allNodes = allNodes.concat(children);
      currentLevelIds = children.map(u => u._id);
    }

    // Build the nested tree from flat allNodes
    const nodesByParent = {};
    allNodes.forEach(n => {
      const pid = n.sponsorId?.toString();
      if (!nodesByParent[pid]) nodesByParent[pid] = [];
      nodesByParent[pid].push(n);
    });

    const buildTree = (parentId, currentLevel) => {
      const children = nodesByParent[parentId.toString()] || [];
      return children.map(child => ({
        ...child,
        level: currentLevel,
        children: buildTree(child._id, currentLevel + 1)
      }));
    };

    const treeNodes = buildTree(currentUser._id, 1);

    return res.json({
      success: true,
      rootUser: {
        _id: currentUser._id,
        username: currentUser.username,
        uhid: currentUser.uhid,
      },
      l1Count: l1Users.length,
      l2Count: l2Count,
      tree: treeNodes,
    });
  } catch (err) {
    console.error('[referralRewards] getMyReferralTree error:', err);
    return res.status(500).json({ success: false, message: 'Server error fetching referral tree.' });
  }
};

module.exports = { getReferralRewardsSummary, getMyReferralTree };
