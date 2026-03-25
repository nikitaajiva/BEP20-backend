const mongoose = require("mongoose");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const CascadeReward = require("../models/CascadeReward");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
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
      console.log("Level check:", rule.level, q);

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
        console.log(`[Booster] User ${user.username} failed tier ${tier}: ${check.reason}`);
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


module.exports = {
  getCascadeRewards,getBoosterRewards
};
