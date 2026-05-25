const mongoose = require("mongoose");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const CascadeReward = require("../models/CascadeReward");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
const NodeReward = require("../models/NodeReward");
const { getTeamVolume, getDirectChildrenVolumes, getDirectChildrenCount } = require("../utils/teamUtils");

const {
  cascadeUnlockRules,
  SponsorUnlockAtLevel,
} = require("../jobs/eventHandlers/differentialRoiCascadeHandler");


const {
  COMMUNITY_TIERS,
  CASCADE_REQUIREMENTS,
} = require("../jobs/eventHandlers/communityBoosterHandler");
const {
  countActiveDirectsBySponsorUhidUsingLedger,
  sumTopNDirectsLpBySponsorUhid,
} = require("../jobs/helpers/directsLp");


/**
 * Check if a sponsor qualifies for a given booster tier
 * @param {String} uhid - Sponsor's UHID
 * @param {Object} tierConfig - { directRequired, teamRequired, bonusLevel, baseRate }
 * @returns {Promise<{qualified: boolean, reason: string, details: object}>}
 */
async function checkBoosterTierQualification(uhid, tierConfig) {
  try {
    // Direct count
    const directCount = await getDirectChildrenCount(uhid);

    // Direct & team volume
    const directVolume = await getTeamVolume(uhid, 1);
    const teamVolume = await getTeamVolume(uhid, 3);

    // Direct children breakdown
    const childrenVolumes = await getDirectChildrenVolumes(uhid);

    // Distribution rule: two strongest children each ≥ 1/3, remaining ≥ 1/3
    const oneThird = tierConfig.teamRequired / 3;
    const [first, second, ...rest] = childrenVolumes;

    const distOk =
      first && second &&
      first.totalVolume >= oneThird &&
      second.totalVolume >= oneThird &&
      rest.reduce((sum, c) => sum + c.totalVolume, 0) >= oneThird;

    // Volume rules
    const meetsDirectVolume = directVolume >= tierConfig.directRequired;
    const meetsTeamVolume = teamVolume >= tierConfig.teamRequired;

    const qualified = meetsDirectVolume && meetsTeamVolume && distOk;

    return {
      qualified,
      reason: qualified ? "Meets requirements" : "Did not meet requirements",
      details: {
        directCount,
        directVolume,
        teamVolume,
        childrenVolumes,
        distribution: {
          oneThird,
          distOk,
        },
      },
    };
  } catch (err) {
    console.error("[checkBoosterTierQualification] Error:", err);
    return { qualified: false, reason: "Error occurred", details: {} };
  }
}


function parseNarrativeLevel(narrative) {
  const match = narrative?.match(/\(L(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function fetchRawCascadeRewards(user, date = null) {
  try {
    const userId = user._id;
    const uhid = user.uhid;

    // Precompute unlock values in parallel
    const [sLedger, activeDirectsCount, teamLp3Sum, teamLp5Sum] =
      await Promise.all([
        Ledger.findOne({ userId }).select("wallets.lp").lean(),
        countActiveDirectsBySponsorUhidUsingLedger(uhid, 9),
        sumTopNDirectsLpBySponsorUhid(uhid, 3),
        sumTopNDirectsLpBySponsorUhid(uhid, 5),
      ]);

    const selfLp = Number(sLedger?.wallets?.lp?.toString?.() ?? 0);
    const precomputed = { selfLp, activeDirectsCount, teamLp3Sum, teamLp5Sum };

    let maxUnlockedLevel = 0;
     const failedLevels = [];

    for (const rule of cascadeUnlockRules) {
      const q = await SponsorUnlockAtLevel(user, rule, precomputed);
      

      if (q.qualified) {
        maxUnlockedLevel = rule.level;
      } else {
        failedLevels.push({
          level: rule.level,
          reason: q.reason,
          details: q, // keep full object for debugging/insights
        });
         break;
      }
    }


    const now = date ? new Date(date) : new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));

const rewards = await CascadeReward.aggregate([
  {
    $match: {
      userId,
      createdAt: { $gte: start, $lte: end }
    }
  },
  {
    $lookup: {
      from: "ledgerrows",
      localField: "triggeringEventId",
      foreignField: "_id",
      as: "ledgerRow"
    }
  },
  { $unwind: { path: "$ledgerRow", preserveNullAndEmptyArrays: true } },

  // lookup into dailyuserlps by ledgerRow.userId + same date
  {
    $lookup: {
      from: "dailyuserlps",
      let: { lrUserId: "$ledgerRow.userId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$userId", "$$lrUserId"] },
                { $gte: ["$date", start] },
                { $lte: ["$date", end] }
              ]
            }
          }
        },
        { $project: { lp: 1, _id: 0 } }
      ],
      as: "dailyLp"
    }
  },
  { $unwind: { path: "$dailyLp", preserveNullAndEmptyArrays: true } },

  {
    $project: {
      amount: 1,
      rate: 1,
      narrative: 1,
      triggeringEventId: 1,
      lp_reward: "$ledgerRow.amount",
      ledgerNarrative: "$ledgerRow.narrative",
      ledgerUserId: "$ledgerRow.userId",
      lp: "$dailyLp.lp"
    }
  }
]);


    return {
      success: true,
      data: {
        uhid,
        username: user.username,
        maxUnlockedLevel,
        failedLevels, // NEW: all failed levels with reasons
        rewards, // raw, no grouping
        range: { start, end },
      },
    };
  } catch (error) {
    console.error("❌ Error in fetchRawCascadeRewards:", error);
    return { success: false, message: error.message };
  }
}
async function fetchRawBoosterRewards(user, date = null) {
  try {
    const userId = user._id;
    const uhid = user.uhid;

    // --- Tier Qualification Checks ---
    const qualifiedTiers = [];
    for (const [tier, config] of Object.entries(COMMUNITY_TIERS)) {
      const check = await checkBoosterTierQualification(user.uhid, config);

      if (check.qualified) {
        qualifiedTiers.push({
          tier: parseInt(tier),
          bonusLevel: config.bonusLevel,
          rate: config.baseRate * 2, // doubled rate
          details: check.details,
        });
      } else {
        
      }
    }

    // --- Rewards Query ---
    // --- Rewards Query ---
    let baseDate;
    if (date) {
      baseDate = new Date(date);
    } else {
      baseDate = new Date();
      baseDate.setUTCDate(baseDate.getUTCDate() - 1); // default: yesterday
    }

    const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 23, 59, 59, 999));

    const rewards = await CommunityBoosterReward.aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $lookup: {
          from: "ledgerrows",
          localField: "triggeringEventId",
          foreignField: "_id",
          as: "ledgerRow"
        }
      },
      { $unwind: { path: "$ledgerRow", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          amount: 1,
          rate: 1,
          narrative: 1,
          triggeringEventId: 1,
          tier:1,
          level:1,
          lp_reward: "$ledgerRow.amount",
          ledgerNarrative: "$ledgerRow.narrative",
          ledgerUserId: "$ledgerRow.userId",
        }
      }
    ]);

    return {
      success: true,
      data: {
        uhid,
        username: user.username,
        qualifiedTiers,   // ✅ booster only
        rewards,
        range: { start, end },
      },
    };
  } catch (error) {
    console.error("❌ Error in fetchRawBoosterRewards:", error);
    return { success: false, message: error.message };
  }
}


const getCascadeRewards = async (req, res) => {
  try {
    const user = req.user;
    const { date } = req.query;

    if (!user.uhid) {
      return res.status(400).json({ success: false, message: "UHID is required" });
    }

    const result = await fetchRawCascadeRewards(user, date);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("❌ Error in getCascadeRewards API:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
const getBoosterRewards = async (req, res) => {
  try {
    const user = req.user;
    const { date } = req.query;

    if (!user.uhid) {
      return res.status(400).json({ success: false, message: "UHID is required" });
    }

    const result = await fetchRawBoosterRewards(user, date);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("❌ Error in getBoosterRewards API:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const getNodeRewards = async (req, res) => {
  try {
    const user = req.user;
    const { date } = req.query;

    if (!user.uhid) {
      return res.status(400).json({ success: false, message: "UHID is required" });
    }

    const userId = user._id;

    let baseDate;
    if (date) {
      baseDate = new Date(date);
    } else {
      baseDate = new Date();
      baseDate.setUTCDate(baseDate.getUTCDate() - 1); // default: yesterday
    }

    const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate(), 23, 59, 59, 999));

    const rewards = await NodeReward.aggregate([
      {
        $match: {
          userId,
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $project: {
          amount: 1,
          nodeTier: 1,
          rewardType: 1,
          narrative: 1,
          createdAt: 1,
        }
      }
    ]);

    return res.json({
      success: true,
      data: {
        uhid: user.uhid,
        username: user.username,
        rewards,
        range: { start, end },
      }
    });

  } catch (error) {
    console.error("❌ Error in getNodeRewards API:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/rewards/airdrop-pool
 * Returns aggregated airdrop pool statistics for the authenticated user.
 * Includes current node tier, lifetime earnings, period summaries, and community wallet balance.
 */
const getAirdropPoolStats = async (req, res) => {
  try {
    const user = req.user;
    const userId = user._id;

    const now = new Date();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const last30DaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last7DaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate lifetime, 30d, 7d, and today totals in a single query
    const [stats] = await NodeReward.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          lifetimeEarnings: { $sum: { $toDouble: "$amount" } },
          rewardCount: { $sum: 1 },
          todayEarnings: {
            $sum: {
              $cond: [{ $gte: ["$createdAt", todayStart] }, { $toDouble: "$amount" }, 0]
            }
          },
          last30DayEarnings: {
            $sum: {
              $cond: [{ $gte: ["$createdAt", last30DaysStart] }, { $toDouble: "$amount" }, 0]
            }
          },
          last7DayEarnings: {
            $sum: {
              $cond: [{ $gte: ["$createdAt", last7DaysStart] }, { $toDouble: "$amount" }, 0]
            }
          }
        }
      }
    ]);

    // Get community rewards balance from ledger
    const ledger = await Ledger.findOne({ userId }).select("wallets.communityRewards").lean();
    const communityRewardsBalance = parseFloat(ledger?.wallets?.communityRewards?.toString?.() || "0").toFixed(6);

    // Node tier share percentages (same as withdrawal controller)
    const TIER_SHARES = {
      P1: 20, P2: 15, P3: 12.5, P4: 11.5, P5: 10.5,
      P6: 9.5, P7: 8.5, P8: 7.5, P9: 5.0
    };

    const nodeTier = user.nodeTier || null;
    const tierSharePct = nodeTier ? (TIER_SHARES[nodeTier] || null) : null;

    return res.json({
      success: true,
      data: {
        nodeTier,
        tierSharePct,
        communityRewardsBalance,
        lifetimeEarnings: parseFloat((stats?.lifetimeEarnings || 0).toFixed(6)),
        todayEarnings: parseFloat((stats?.todayEarnings || 0).toFixed(6)),
        last30DayEarnings: parseFloat((stats?.last30DayEarnings || 0).toFixed(6)),
        last7DayEarnings: parseFloat((stats?.last7DayEarnings || 0).toFixed(6)),
        rewardCount: stats?.rewardCount || 0,
      }
    });
  } catch (error) {
    console.error("❌ Error in getAirdropPoolStats API:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/**
 * GET /api/rewards/airdrop-pool/history?page=1&limit=20
 * Returns paginated NodeReward history for the authenticated user.
 */
const getAirdropPoolHistory = async (req, res) => {
  try {
    const user = req.user;
    const userId = user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [rewards, total] = await Promise.all([
      NodeReward.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      NodeReward.countDocuments({ userId })
    ]);

    // Serialize Decimal128 values to strings/numbers
    const serialized = rewards.map(r => ({
      id: r._id.toString(),
      nodeTier: r.nodeTier,
      rewardType: r.rewardType,
      amount: parseFloat(r.amount?.toString?.() || "0"),
      narrative: r.narrative,
      withdrawalAmount: r.withdrawalAmount ? parseFloat(r.withdrawalAmount.toString()) : null,
      tierSharePct: r.tierSharePct ? (r.tierSharePct * 100) : null,
      triggeringWithdrawalId: r.triggeringWithdrawalId || null,
      createdAt: r.createdAt,
    }));

    return res.json({
      success: true,
      data: {
        rewards: serialized,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error("❌ Error in getAirdropPoolHistory API:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = {
  getCascadeRewards,
  getBoosterRewards,
  getNodeRewards,
  getAirdropPoolStats,
  getAirdropPoolHistory,
};

