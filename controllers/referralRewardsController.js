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

    // ── 5.5. Self & Team Staking & Horse NFT calculations ───────────────────
    const TokenStaking = require('../models/TokenStaking');
    const UserHorseNft = require('../server/Modules/horseNft/Models/UserHorseNft');

    // Fetch full currentUser document to get legacy fields safely
    const currentUserDoc = await User.findById(currentUser._id)
      .select('stakingPlan stakingPlans nftPackages')
      .lean();

    // Query active dedicated stakings for self
    const selfDedicatedStakings = await TokenStaking.find({
      user: currentUser._id,
      status: 'active'
    }).lean();

    let selfStakingTotal = selfDedicatedStakings.reduce(
      (acc, s) => acc + parseFloat(s.tokenAmount || s.tscAmount || (s.amount / 0.01) || 0),
      0
    );

    // Sum legacy active stakings for self
    if (currentUserDoc) {
      const legacyPlansSum = (currentUserDoc.stakingPlans || []).reduce(
        (sum, plan) => plan.status === 'active' ? sum + parseFloat(plan.tokenAmount || plan.tscAmount || plan.amount || 0) : sum,
        0
      );
      const legacySinglePlanSum = (currentUserDoc.stakingPlan && currentUserDoc.stakingPlan.status === 'active')
        ? parseFloat(currentUserDoc.stakingPlan.tokenAmount || currentUserDoc.stakingPlan.tscAmount || currentUserDoc.stakingPlan.amount || 0)
        : 0;
      selfStakingTotal += legacyPlansSum + legacySinglePlanSum;
    }

    // Query active dedicated Horse NFTs for self
    const selfDedicatedHorseNfts = await UserHorseNft.find({
      user: currentUser._id,
      status: 'ACTIVE'
    }).lean();

    let selfHorseNftTotal = selfDedicatedHorseNfts.reduce(
      (acc, nft) => acc + parseFloat(nft.purchasePriceUSDT || 0),
      0
    );

    // Sum legacy active Horse NFTs for self
    if (currentUserDoc) {
      const legacyNftSum = (currentUserDoc.nftPackages || []).reduce(
        (sum, pkg) => (pkg.nftType === 'horse' && pkg.status === 'active') ? sum + parseFloat(pkg.mintPrice || 0) : sum,
        0
      );
      selfHorseNftTotal += legacyNftSum;
    }

    // Fetch all downlines recursively via path array
    const downlineUsers = await User.find({ path: currentUser._id })
      .select('_id stakingPlan stakingPlans nftPackages')
      .lean();
    const downlineIds = downlineUsers.map(u => u._id);

    // Query active dedicated stakings for team
    const teamDedicatedStakings = downlineIds.length > 0
      ? await TokenStaking.find({ user: { $in: downlineIds }, status: 'active' }).lean()
      : [];

    let teamStakingTotal = teamDedicatedStakings.reduce(
      (acc, s) => acc + parseFloat(s.tokenAmount || s.tscAmount || (s.amount / 0.01) || 0),
      0
    );

    // Sum legacy active stakings for team
    downlineUsers.forEach(u => {
      const legacyPlansSum = (u.stakingPlans || []).reduce(
        (sum, plan) => plan.status === 'active' ? sum + parseFloat(plan.tokenAmount || plan.tscAmount || plan.amount || 0) : sum,
        0
      );
      const legacySinglePlanSum = (u.stakingPlan && u.stakingPlan.status === 'active')
        ? parseFloat(u.stakingPlan.tokenAmount || u.stakingPlan.tscAmount || u.stakingPlan.amount || 0)
        : 0;
      teamStakingTotal += legacyPlansSum + legacySinglePlanSum;
    });

    // Query active dedicated Horse NFTs for team
    const teamDedicatedHorseNfts = downlineIds.length > 0
      ? await UserHorseNft.find({ user: { $in: downlineIds }, status: 'ACTIVE' }).lean()
      : [];

    let teamHorseNftTotal = teamDedicatedHorseNfts.reduce(
      (acc, nft) => acc + parseFloat(nft.purchasePriceUSDT || 0),
      0
    );

    // Sum legacy active Horse NFTs for team
    downlineUsers.forEach(u => {
      const legacyNftSum = (u.nftPackages || []).reduce(
        (sum, pkg) => (pkg.nftType === 'horse' && pkg.status === 'active') ? sum + parseFloat(pkg.mintPrice || 0) : sum,
        0
      );
      teamHorseNftTotal += legacyNftSum;
    });

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
        selfStaking: selfStakingTotal,
        selfHorseNft: selfHorseNftTotal,
        teamStaking: teamStakingTotal,
        teamHorseNft: teamHorseNftTotal,
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

    // ─── Query new stats ───
    const TokenStaking = require("../models/TokenStaking");
    const RewardTransaction = require("../models/RewardTransaction");
    const UserHorseNft = require("../server/Modules/horseNft/Models/UserHorseNft");

    // 1. Personal Staking (active)
    const activeStakings = await TokenStaking.find({
      user: { $in: nodeIds },
      status: "active"
    }).lean();

    const personalStakingByUser = {};
    nodeIds.forEach(id => {
      personalStakingByUser[id.toString()] = 0;
    });
    activeStakings.forEach(s => {
      const uid = s.user.toString();
      personalStakingByUser[uid] = (personalStakingByUser[uid] || 0) + parseFloat(s.amount?.toString() || "0");
    });
    // Add legacy stakings from user records
    allNodes.forEach(user => {
      const uid = user._id.toString();
      const plansSum = (user.stakingPlans || []).reduce((sum, plan) => {
        if (plan.status === 'active') return sum + (plan.amount || 0);
        return sum;
      }, 0);
      const singlePlanSum = (user.stakingPlan && user.stakingPlan.status === 'active')
        ? (user.stakingPlan.amount || 0)
        : 0;
      personalStakingByUser[uid] = (personalStakingByUser[uid] || 0) + plansSum + singlePlanSum;
    });

    // 2. Personal Horse NFT (active)
    const activeHorseNfts = await UserHorseNft.find({
      user: { $in: nodeIds },
      status: "ACTIVE"
    }).lean();

    const personalHorseNftByUser = {};
    nodeIds.forEach(id => {
      personalHorseNftByUser[id.toString()] = 0;
    });
    activeHorseNfts.forEach(nft => {
      const uid = nft.user.toString();
      personalHorseNftByUser[uid] = (personalHorseNftByUser[uid] || 0) + parseFloat(nft.purchasePriceUSDT?.toString() || "0");
    });
    // Add legacy horse nft packages from user records
    allNodes.forEach(user => {
      const uid = user._id.toString();
      const legacySum = (user.nftPackages || []).reduce((sum, pkg) => {
        if (pkg.nftType === 'horse' && pkg.status === 'active') {
          return sum + (pkg.mintPrice || 0);
        }
        return sum;
      }, 0);
      personalHorseNftByUser[uid] = (personalHorseNftByUser[uid] || 0) + legacySum;
    });

    // 3. Parent Commission from staking
    // Fetch all stakings (active & completed) for the downline nodes to map ID -> User ID
    const allStakings = await TokenStaking.find({
      user: { $in: nodeIds }
    }).lean();

    const stakingIdToUserId = {};
    const stakingIds = [];
    allStakings.forEach(s => {
      const sid = s._id.toString();
      stakingIdToUserId[sid] = s.user.toString();
      stakingIds.push(sid);
    });

    const parentCommissionByUser = {};
    nodeIds.forEach(id => {
      parentCommissionByUser[id.toString()] = 0;
    });

    if (stakingIds.length > 0) {
      const commissionRows = await LedgerRow.find({
        eventType: 'REFERRAL_L1_STAKING',
        refId: { $in: stakingIds }
      }).lean();

      commissionRows.forEach(row => {
        const stakingId = row.refId;
        const userId = stakingIdToUserId[stakingId];
        if (userId) {
          parentCommissionByUser[userId] = (parentCommissionByUser[userId] || 0) + parseFloat(row.amount?.toString() || "0");
        }
      });
    }

    // 4. Daily Earnings (USDT & TSC)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const EARNINGS_EVENT_TYPES = [
      'ROI_CREDIT', 'ROI_CASCADE', 'BOOST_BONUS', 'DAILY_REWARDS_COMMUNITY_BOOSTER',
      'X_BONUS_REWARD', 'XPOWER_REWARDS', 'HORSE_NFT_PAYOUT', 'REFERRAL_L1_STAKING',
      'REFERRAL_L2_STAKING', 'REFERRAL_L1_MINING', 'REFERRAL_L2_MINING', 'DAILY_REWARDS_LP',
      'DAILY_REWARDS_SWIFT', 'DAILY_REWARDS_BOOST', 'DAILY_REWARDS_AIRDROP', 'DAILY_COMMUNITY_REWARDS'
    ];

    const ledgerRowsToday = await LedgerRow.find({
      userId: { $in: nodeIds },
      ts: { $gte: todayStart },
      eventType: { $in: EARNINGS_EVENT_TYPES }
    }).lean();

    const rewardTransactionsToday = await RewardTransaction.find({
      user: { $in: nodeIds },
      direction: 'CREDIT',
      status: { $ne: 'REVERSED' },
      createdAt: { $gte: todayStart }
    }).lean();

    const earningsByUser = {};
    nodeIds.forEach(id => {
      earningsByUser[id.toString()] = { usdt: 0, tsc: 0 };
    });

    ledgerRowsToday.forEach(row => {
      const uid = row.userId.toString();
      const amt = parseFloat(row.amount?.toString() || "0");
      const tscAmt = parseFloat(row.tscAmount?.toString() || "0");
      if (!earningsByUser[uid]) earningsByUser[uid] = { usdt: 0, tsc: 0 };
      earningsByUser[uid].usdt += amt;
      earningsByUser[uid].tsc += tscAmt;
    });

    rewardTransactionsToday.forEach(tx => {
      const uid = tx.user.toString();
      const amt = parseFloat(tx.amount?.toString() || "0");
      if (!earningsByUser[uid]) earningsByUser[uid] = { usdt: 0, tsc: 0 };
      earningsByUser[uid].tsc += amt;
    });

    // Enrich allNodes with personalStaking, personalHorseNft, commissionToParent, and todaysEarnings
    allNodes = allNodes.map(node => {
      const uid = node._id.toString();
      return {
        ...node,
        personalStaking: personalStakingByUser[uid] || 0,
        personalHorseNft: personalHorseNftByUser[uid] || 0,
        commissionToParent: parentCommissionByUser[uid] || 0,
        todaysEarnings: earningsByUser[uid] || { usdt: 0, tsc: 0 }
      };
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
