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

    // ── 4. New automatic USDT referral reward rows (from referralRewardService)
    //       These are credited directly TO the current user by the cron jobs.
    const newL1EventTypes = ['REFERRAL_L1_STAKING', 'REFERRAL_L1_MINING'];
    const newL2EventTypes = ['REFERRAL_L2_STAKING', 'REFERRAL_L2_MINING'];

    const sumUsdtRows = async (eventTypes) => {
      const agg = await LedgerRow.aggregate([
        {
          $match: {
            userId: currentUser._id,
            eventType: { $in: eventTypes },
          },
        },
        {
          $group: {
            _id: null,
            totalUsdt: {
              $sum: {
                $convert: { input: '$amount', to: 'double', onError: 0, onNull: 0 },
              },
            },
            count: { $sum: 1 },
          },
        },
      ]);
      return agg.length > 0 ? agg[0] : { totalUsdt: 0, count: 0 };
    };

    const [l1UsdtAgg, l2UsdtAgg] = await Promise.all([
      sumUsdtRows(newL1EventTypes),
      sumUsdtRows(newL2EventTypes),
    ]);

    // ── 5. Legacy TSC token earnings (old event types via refId matching) ────
    const legacyEventTypes = ['NFT_PURCHASE', 'BOOST_BONUS', 'ROI_CASCADE'];

    let l1TokenEarnings = 0;
    let l1TxCount = 0;

    if (l1Ids.length > 0) {
      const l1IdStrings = l1Ids.map(id => id.toString());
      const l1Agg = await LedgerRow.aggregate([
        {
          $match: {
            userId: currentUser._id,
            eventType: { $in: legacyEventTypes },
            refId: { $in: l1IdStrings },
          },
        },
        {
          $group: {
            _id: null,
            totalTsc: {
              $sum: {
                $convert: { input: '$tscAmount', to: 'double', onError: 0, onNull: 0 },
              },
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

    let l2TokenEarnings = 0;
    let l2TxCount = 0;

    if (l2Ids.length > 0) {
      const l2IdStrings = l2Ids.map(id => id.toString());
      const l2Agg = await LedgerRow.aggregate([
        {
          $match: {
            userId: currentUser._id,
            eventType: { $in: legacyEventTypes },
            refId: { $in: l2IdStrings },
          },
        },
        {
          $group: {
            _id: null,
            totalTsc: {
              $sum: {
                $convert: { input: '$tscAmount', to: 'double', onError: 0, onNull: 0 },
              },
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

    // ── 6. Build response ────────────────────────────────────────────────────
    return res.json({
      success: true,
      data: {
        l1: {
          count: l1Users.length,
          usdtEarnings: parseFloat((l1UsdtAgg.totalUsdt || 0).toFixed(6)),
          usdtTxCount: l1UsdtAgg.count || 0,
          tokenEarnings: parseFloat(l1TokenEarnings.toFixed(6)),
          transactionCount: l1TxCount,
          ratePercent: l1Rate,
        },
        l2: {
          count: l2Users.length,
          usdtEarnings: parseFloat((l2UsdtAgg.totalUsdt || 0).toFixed(6)),
          usdtTxCount: l2UsdtAgg.count || 0,
          tokenEarnings: parseFloat(l2TokenEarnings.toFixed(6)),
          transactionCount: l2TxCount,
          ratePercent: l2Rate,
        },
        totalUsdtEarnings: parseFloat(
          ((l1UsdtAgg.totalUsdt || 0) + (l2UsdtAgg.totalUsdt || 0)).toFixed(6)
        ),
        totalTokenEarnings: parseFloat((l1TokenEarnings + l2TokenEarnings).toFixed(6)),
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

    // Query staked UserNft values for all downline node IDs to sum in the tree
    const UserNft = require("../models/UserNft");
    const nodeIds = allNodes.map(n => n._id);
    const userNfts = await UserNft.find({ user: { $in: nodeIds }, status: "STAKED" }).lean();

    const nftValueByUser = {};
    userNfts.forEach(nft => {
      const uid = nft.user.toString();
      const mintPrice = parseFloat(nft.mintPriceU?.toString() || "0");
      nftValueByUser[uid] = (nftValueByUser[uid] || 0) + mintPrice;
    });

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

    const enrichTreeNodes = (nodes) => {
      return nodes.map(node => {
        let teamStakes = 0;
        let teamNfts = 0;
        let enrichedChildren = [];

        if (node.children && node.children.length > 0) {
          enrichedChildren = enrichTreeNodes(node.children);
          enrichedChildren.forEach(child => {
            const childOwnStakes = (child.stakingPlans || []).reduce((acc, s) => acc + (s.amount || 0), 0) || child.stakingPlan?.amount || 0;
            const legacyOwnNfts = (child.nftPackages || []).reduce((acc, p) => acc + (p.mintPrice || 0), 0);
            const newOwnNfts = nftValueByUser[child._id.toString()] || 0;
            const childOwnNfts = legacyOwnNfts + newOwnNfts;

            teamStakes += childOwnStakes + (child.teamStakes || 0);
            teamNfts += childOwnNfts + (child.teamNfts || 0);
          });
        }

        return {
          ...node,
          children: enrichedChildren,
          teamStakes,
          teamNfts
        };
      });
    };

    const treeNodes = enrichTreeNodes(buildTree(currentUser._id, 1));

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
