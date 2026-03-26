const mongoose = require("mongoose");
const moment = require("moment");
const User = require("../models/User");
const Level = require("../models/Level");
const LedgerRow = require("../models/LedgerRow");

const Ledger = require("../models/Ledger");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
const CascadeReward = require("../models/CascadeReward");
const { getTeamVolume } = require("../utils/teamUtils");
const {
  cascadeUnlockRules,
  checkSponsorUnlockAtLevel,
} = require("../jobs/eventHandlers/differentialRoiCascadeHandler");

const {
  countActiveDirectsBySponsorUhidUsingLedger,
  sumTopNDirectsLpBySponsorUhid,
} = require("../jobs/helpers/directsLp");
// Community Booster Tiers Configuration (matching handler)
const COMMUNITY_TIERS = {
  10000: {
    directRequired: 2000,
    teamRequired: 10000,
    bonusLevel: 1,
    baseRate: 0.12,
  },
  20000: {
    directRequired: 6000,
    teamRequired: 20000,
    bonusLevel: 2,
    baseRate: 0.1,
  },
  30000: {
    directRequired: 12000,
    teamRequired: 30000,
    bonusLevel: 3,
    baseRate: 0.07,
  },
};

// Cascade level requirements (matching handler)
const CASCADE_REQUIREMENTS = [
  { level: 1, minDirects: 1, minSelfLP: 9 },
  { level: 2, minDirects: 2, minSelfLP: 9 },
  { level: 3, minDirects: 3, minSelfLP: 9 },
];

/**
 * GET /api/bonus/community/summary
 * Query params: user, date(YYYY-MM-DD)
 */
const getBoosterSummary = async (req, res) => {
  try {
    const { user: identifier, date } = req.query;
    if (!identifier) {
      return res.status(400).json({ msg: "user query param required" });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { uhid: identifier }],
    })
      .select("_id uhid username")
      .lean();

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const targetDate = moment(date).startOf("day");
    const nextDate = moment(targetDate).add(1, "day");

    // Get direct team count and team volumes
    const directCount = await Level.countDocuments({
      parent: user.uhid,
      level: 1,
    });
    const directVolume = await getTeamVolume(user.uhid, 1); // Level 1 volume
    const teamVolume = await getTeamVolume(user.uhid, 3); // Level 1-3 volume

    // Get self LP
    const ledger = await Ledger.findOne({ uhid: user.uhid })
      .select("wallets.lp")
      .lean();
    const selfLP = ledger ? parseFloat(ledger.wallets.lp.toString()) : 0;

    // Check which tiers are qualified
    const qualifiedTiers = [];
    for (const [tier, requirements] of Object.entries(COMMUNITY_TIERS)) {
      // First check if the corresponding cascade level is open
      const cascadeReq = CASCADE_REQUIREMENTS[requirements.bonusLevel - 1];
      const meetsBasicRequirements =
        directCount >= cascadeReq.minDirects && selfLP >= cascadeReq.minSelfLP;

      if (meetsBasicRequirements) {
        const meetsDirectVolume = directVolume >= requirements.directRequired;
        const meetsTeamVolume = teamVolume >= requirements.teamRequired;

        if (meetsDirectVolume && meetsTeamVolume) {
          qualifiedTiers.push({
            tier: parseInt(tier),
            bonusLevel: requirements.bonusLevel,
            rate: requirements.baseRate * 2, // Show doubled rate
          });
        }
      }
    }

    // Get today's rewards
    const todayRewards = await CommunityBoosterReward.find({
      userId: user._id,
      createdAt: { $gte: targetDate.toDate(), $lt: nextDate.toDate() },
    })
      .populate("triggeringUserId", "username")
      .populate("triggeringEventId", "amount ts")
      .lean();

    const summary = {
      user: { _id: user._id, uhid: user.uhid, username: user.username },
      volumes: {
        directVolume,
        teamVolume,
      },
      conditions: {
        directs: directCount,
        selfLP,
        required:
          qualifiedTiers.length > 0
            ? `Qualified for Tiers: ${qualifiedTiers
                .map((t) => t.tier)
                .join(", ")}`
            : "No tiers qualified - check volume requirements",
      },
      qualifiedTiers,
      credited: {
        total: todayRewards.reduce((sum, r) => sum + parseFloat(r.amount), 0),
        events: todayRewards.map((reward) => ({
          ts: reward.createdAt,
          amount: reward.amount,
          level: reward.level,
          tier: reward.tier,
          rate: reward.rate,
          from: reward.triggeringUserId?.username || "Unknown",
          triggeringAmount: reward.triggeringEventId?.amount || "0",
          triggeringDate: reward.triggeringEventId?.ts || reward.createdAt,
          narrative: reward.narrative,
        })),
      },
    };

    res.json(summary);
  } catch (error) {
    console.error("Error in getBoosterSummary:", error);
    res.status(500).json({ msg: "Server error" });
  }
};
// Safely coerce Decimal128 / strings / BigNumber-ish to a JS number
const toNum = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v === "bigint") return Number(v);
  // Mongoose Decimal128 or similar
  if (v && typeof v === "object" && "$numberDecimal" in v) {
    return Number(v.$numberDecimal) || 0;
  }
  try {
    return Number(v.toString());
  } catch (_) {
    return 0;
  }
};

// ---- helpers used by both modes ----
const DEBUG_SNAPSHOT = true;

const getActiveDirectsStrict = async (sponsorUhid) => {
  if (DEBUG_SNAPSHOT) {
    console.group(`[Cascade] getActiveDirectsStrict`);
    console.time(`  ⏱ ActiveDirects (${sponsorUhid})`);
    console.log(`  → Input sponsorUhid:`, sponsorUhid);
  }

  // If your collection name for Level isn't "levels", replace 'levels' below
  // with Level.collection.name
  const rows = await Level.aggregate([
    { $match: { parent: sponsorUhid, level: 1 } },

    // child's self LP
    {
      $lookup: {
        from: "ledgers",
        localField: "child",
        foreignField: "uhid",
        as: "childLedger",
      },
    },
    { $unwind: "$childLedger" },
    {
      $addFields: {
        childSelfLpDecimal: {
          $convert: {
            input: "$childLedger.wallets.lp",
            to: "decimal",
            onNull: 0,
            onError: 0,
          },
        },
      },
    },
    { $match: { childSelfLpDecimal: { $gt: 9 } } },

    // NEW: compute this child's team LP = sum of that child's active directs' self LP (strict > 9)
    {
      $lookup: {
        from: "levels", // <-- change if needed: Level.collection.name
        let: { directUhid: "$child" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$parent", "$$directUhid"] },
                  { $eq: ["$level", 1] }, // L1 under the direct
                ],
              },
            },
          },
          {
            $lookup: {
              from: "ledgers",
              localField: "child",
              foreignField: "uhid",
              as: "gcLedger",
            },
          },
          { $unwind: "$gcLedger" },
          {
            $addFields: {
              gcSelfLpDecimal: {
                $convert: {
                  input: "$gcLedger.wallets.lp",
                  to: "decimal",
                  onNull: 0,
                  onError: 0,
                },
              },
            },
          },
          { $match: { gcSelfLpDecimal: { $gt: 9 } } }, // strict active under the direct
          { $group: { _id: null, teamLp: { $sum: "$gcSelfLpDecimal" } } },
        ],
        as: "teamAgg",
      },
    },
    {
      $addFields: {
        teamLpDecimal: { $ifNull: [{ $first: "$teamAgg.teamLp" }, 0] },
      },
    },

    {
      $project: {
        _id: 0,
        uhid: "$child",
        selfLp: "$childSelfLpDecimal",
        teamLp: "$teamLpDecimal", // <-- NEW field
      },
    },
  ]);

  const mapped = rows.map((r) => ({
    uhid: r.uhid,
    selfLp: Number(r.selfLp?.toString?.() ?? r.selfLp ?? 0),
    teamLp: Number(r.teamLp?.toString?.() ?? r.teamLp ?? 0), // <-- include in output
  }));

  if (DEBUG_SNAPSHOT) {
    console.timeEnd(`  ⏱ ActiveDirects (${sponsorUhid})`);
    console.log(`  → ActiveDirects count:`, mapped.length);
    if (mapped.length) {
      console.log(`  → ActiveDirects sample (top 6):`);
      console.table(mapped.slice(0, 6));
    }
    console.groupEnd();
  }

  return mapped;
};

const getUplinesBatch = async (childUhid, maxDepth = 128) => {
  if (DEBUG_SNAPSHOT) {
    console.group(`[Cascade] getUplinesBatch`);
    console.time(`  ⏱ Uplines (${childUhid})`);
    console.log(`  → Input childUhid:`, childUhid, `maxDepth:`, maxDepth);
  }

  const batch = await Level.find({
    child: childUhid,
    level: { $gte: 1, $lte: maxDepth },
  })
    .sort({ level: 1 })
    .select("parent")
    .lean();

  const uhids = batch.map((b) => b.parent);

  if (DEBUG_SNAPSHOT) {
    console.timeEnd(`  ⏱ Uplines (${childUhid})`);
    console.log(`  → Uplines found:`, uhids.length);
    if (uhids.length) {
      console.log(`  → Uplines sample (top 10):`, uhids.slice(0, 10));
    }
    console.groupEnd();
  }

  return uhids;
};

const makeSnapshotForSponsorAtLevel = async (sponsorDoc, rule) => {
  // self LP
  const sLedger = await Ledger.findOne({ userId: sponsorDoc._id })
    .select("wallets.lp")
    .lean();
  const selfLp = Number(sLedger?.wallets?.lp?.toString?.() ?? 0);

  // teamLpSum (top3/top5 when applicable)
  let teamLpSum = null;
  if (rule.selfLpOrTeamLp3) {
    if (rule.selfLpOrTeamLp3.teamLp3 != null) {
      teamLpSum = await sumTopNDirectsLpBySponsorUhid(sponsorDoc.uhid, 3);
    }
  } else if (rule.selfLpOrTeamLp5) {
    teamLpSum = await sumTopNDirectsLpBySponsorUhid(sponsorDoc.uhid, 5);
  }

  // active directs (strict > 9)
  const ActiveDirects = await getActiveDirectsStrict(sponsorDoc.uhid);

  // NEW: simple total of ALL active directs' self LP
  const teamLp = ActiveDirects.reduce(
    (sum, d) => sum + (Number(d.selfLp) || 0),
    0
  );

  return {
    uhid: sponsorDoc.uhid,
    levelUnlocked: rule.level,
    selfLp,
    teamLpSum, // (top3/top5) – already there
    teamLp, // <— NEW: all active directs' total
    ActiveDirects,
    pct: rule.pct,
  };
};

// =====================================================
// GET /api/cascade/snapshot
// - default: single snapshot (existing behavior)
// - trail mode: ?mode=trail&depositor=<username|uhid>  -> level-by-level
//   Optional: &startLevel=1&maxLevel=16
// =====================================================
// GET /api/cascade/snapshot
// - default: single snapshot (existing behavior)
// - trail mode: ?mode=trail&depositor=<username|uhid>
//   Optional: &startLevel=1&maxLevel=16&depositAmount=<number>
//   Returns: { depositor, logs: [ "L4: skip …", "L4: PAID …" ], snapshots: [...] }
// =====================================================
// =====================================================
// GET /api/cascade/snapshot
// - default: single snapshot (existing behavior)
// - trail mode: ?mode=trail&depositor=<username|uhid>
//   Optional: &startLevel=1&maxLevel=16&depositAmount=<number>
//   Returns: { depositor, logs: [ "L4: skip …", "L4: PAID …" ], snapshots: [...] }
// =====================================================
const getCascadeSnapshot = async (req, res) => {
  const LOG = true;
  try {
    const {
      sponsor,
      level,
      mode,
      depositor,
      uhid,
      startLevel,
      maxLevel,
      depositAmount,
      date, // NEW: accept date from query
    } = req.query;

    const modeStr = String(mode || "").toLowerCase();
    const wantTrail =
      modeStr === "trail" ||
      (!!uhid && !sponsor && !level && !modeStr) ||
      !!depositor;

    // ---------------- TRAIL MODE ----------------
    if (wantTrail && modeStr !== "single") {
      const depositorKey = depositor || uhid || sponsor;
      if (!depositorKey) {
        return res.status(400).json({
          msg: "depositor/uhid (username or uhid) required for trail mode",
        });
      }

      if (LOG) {
        console.group(`[CascadeTrail]`);
        console.time(`[CascadeTrail] total`);
        console.log(`→ Params`, {
          depositor: depositorKey,
          startLevel: Number(startLevel) || 1,
          maxLevel: Number(maxLevel) || 16,
          depositAmount: depositAmount != null ? Number(depositAmount) : null,
          date,
        });
      }

      // resolve depositor
      const depUser = await User.findOne({
        $or: [{ uhid: depositorKey }, { username: depositorKey }],
      })
        .select("_id uhid username")
        .lean();

      if (!depUser) {
        if (LOG) {
          console.warn("! Depositor not found");
          console.groupEnd();
        }
        return res.status(404).json({ msg: "Depositor not found" });
      }

      // ---------------- DATE FILTER ----------------
      let dateFilter = {};
      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        dateFilter = { createdAt: { $gte: startOfDay, $lte: endOfDay } };
      }

      // ---------------- CascadeReward fetch ----------------
      const cascadeRewards = await CascadeReward.find({
        userId: depUser._id,
        ...dateFilter,
      }).lean();

      const cascadeRewardsSum = await CascadeReward.aggregate([
        { $match: { userId: depUser._id, ...dateFilter } },
        { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
      ]);

      const totalCascadeAmount = cascadeRewardsSum[0]?.totalAmount || 0;

      // ---------------- Ledger + LP metrics ----------------
      const [depLedger, depTeamLp3, depTeamLp5, depActiveDirects] =
        await Promise.all([
          Ledger.findOne({ userId: depUser._id }).select("wallets.lp").lean(),
          sumTopNDirectsLpBySponsorUhid(depUser.uhid, 3),
          sumTopNDirectsLpBySponsorUhid(depUser.uhid, 5),
          getActiveDirectsStrict(depUser.uhid),
        ]);

      const depSelfLp = Number(depLedger?.wallets?.lp?.toString?.() ?? 0);

      if (LOG) {
        console.log("→ Searched user LP snapshot", {
          selfLp: depSelfLp,
          teamLp3Sum: depTeamLp3,
          teamLp5Sum: depTeamLp5,
          activeDirectsStrict: depActiveDirects.length,
          cascadeRewardsCount: cascadeRewards.length,
          totalCascadeAmount,
        });
      }

      // ---------------- Cascade Trail Loop ----------------
      let targetLevelNum = Number(startLevel) || 1;
      const maxLevelNum = Math.min(Number(maxLevel) || 16, 16);

      let searchChild = depUser.uhid;
      const seenUhids = new Set();
      let cursor = [];
      let idx = 0;

      const logs = [];
      const snapshots = [];

      while (targetLevelNum <= maxLevelNum) {
        if (idx >= cursor.length) {
          const uhids = (await getUplinesBatch(searchChild, 128)).filter(
            (u) => !seenUhids.has(u)
          );
          if (!uhids.length) {
            logs.push(
              `Stop: no more uplines to search for level ${targetLevelNum}`
            );
            break;
          }
          uhids.forEach((u) => seenUhids.add(u));

          const users = await User.find({ uhid: { $in: uhids } })
            .select("_id uhid username")
            .lean();
          const byUhid = new Map(users.map((u) => [u.uhid, u]));
          cursor = uhids.map((u) => byUhid.get(u)).filter(Boolean);
          idx = 0;
          searchChild = uhids[uhids.length - 1];
        }

        if (idx >= cursor.length) continue;
        const sponsorDoc = cursor[idx++];
        const rule = cascadeUnlockRules.find((r) => r.level === targetLevelNum);
        if (!rule) {
          targetLevelNum++;
          continue;
        }

        const q = await checkSponsorUnlockAtLevel(sponsorDoc, rule);
        if (!q.qualified) {
          logs.push(
            `L${targetLevelNum}: skip ${sponsorDoc.username} → ${q.reason}`
          );
          continue;
        }

        const snap = await makeSnapshotForSponsorAtLevel(sponsorDoc, rule);

        snapshots.push(snap);
        logs.push(
          `L${targetLevelNum}: PAID ${sponsorDoc.username} = @ ${snap.pct}`
        );

        targetLevelNum++;
      }

      if (LOG) {
        console.log(`→ snapshots count:`, snapshots.length);
        console.timeEnd(`[CascadeTrail] total`);
        console.groupEnd();
      }

      // ---------------- RESPONSE ----------------
      return res.json({
        depositor: {
          _id: depUser._id,
          uhid: depUser.uhid,
          username: depUser.username,
          selfLp: depSelfLp,
          teamLp3Sum: depTeamLp3,
          teamLp5Sum: depTeamLp5,
          activeDirects: depActiveDirects,
          activeDirectsCount: depActiveDirects.length,

          // NEW
          cascadeRewards,
          totalCascadeAmount,
        },
        headerUser: {
          _id: depUser._id,
          uhid: depUser.uhid,
          username: depUser.username,
          selfLp: depSelfLp,
          teamLp3Sum: depTeamLp3,
          teamLp5Sum: depTeamLp5,
        },
        logs,
        snapshots,
      });
    }

    // ---------------- SINGLE SNAPSHOT ----------------
    // (unchanged from your original code)
    const sponsorKey = sponsor || uhid;
    if (!sponsorKey) {
      return res
        .status(400)
        .json({ msg: "sponsor or uhid (username|uhid) required" });
    }

    const user = await User.findOne({
      $or: [{ uhid: sponsorKey }, { username: sponsorKey }],
    })
      .select("_id uhid username")
      .lean();

    if (!user) return res.status(404).json({ msg: "Sponsor not found" });

    let targetLevel = Number(level);
    if (!targetLevel || targetLevel < 1 || targetLevel > 16) {
      targetLevel = 0;
      for (const r of cascadeUnlockRules) {
        const q = await checkSponsorUnlockAtLevel(user, r);
        if (q.qualified) targetLevel = r.level;
      }
      if (targetLevel === 0) {
        const [sLedger, team3, team5] = await Promise.all([
          Ledger.findOne({ userId: user._id }).select("wallets.lp").lean(),
          sumTopNDirectsLpBySponsorUhid(user.uhid, 3),
          sumTopNDirectsLpBySponsorUhid(user.uhid, 5),
        ]);
        const self = Number(sLedger?.wallets?.lp?.toString?.() ?? 0);

        return res.json({
          uhid: user.uhid,
          levelUnlocked: 0,
          selfLp: 0,
          teamLpSum: 0,
          ActiveDirects: [],
          pct: null,
          headerUser: {
            _id: user._id,
            uhid: user.uhid,
            username: user.username,
            selfLp: self,
            teamLp3Sum: team3,
            teamLp5Sum: team5,
          },
        });
      }
    }

    const rule = cascadeUnlockRules.find((r) => r.level === targetLevel);
    if (!rule) return res.status(400).json({ msg: "Invalid level" });

    const snap = await makeSnapshotForSponsorAtLevel(user, rule);

    const [sLedger, team3, team5] = await Promise.all([
      Ledger.findOne({ userId: user._id }).select("wallets.lp").lean(),
      sumTopNDirectsLpBySponsorUhid(user.uhid, 3),
      sumTopNDirectsLpBySponsorUhid(user.uhid, 5),
    ]);
    const self = Number(sLedger?.wallets?.lp?.toString?.() ?? 0);

    return res.json({
      ...snap,
      headerUser: {
        _id: user._id,
        uhid: user.uhid,
        username: user.username,
        selfLp: self,
        teamLp3Sum: team3,
        teamLp5Sum: team5,
      },
    });
  } catch (err) {
    console.error("getCascadeSnapshot error:", err);
    try {
      console.groupEnd();
    } catch (_) {}
    return res.status(500).json({ msg: "Server error" });
  }
};

/**
 * GET /api/bonus/community/details
 * Query params: user, type(team|events), date(YYYY-MM-DD)
 */
const getBoosterDetails = async (req, res) => {
  try {
    const { user: identifier, date, type = "team" } = req.query;
    if (!identifier) {
      return res.status(400).json({ msg: "user query param required" });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { uhid: identifier }],
    })
      .select("_id uhid username")
      .lean();

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const targetDate = moment(date).startOf("day");
    const nextDate = moment(targetDate).add(1, "day");

    if (type === "team") {
      // Get team members and their volumes
      const teamMembers = await Level.find({
        parent: user.uhid,
        level: { $lte: 3 },
      })
        .populate("child", "username")
        .lean();

      const teamDetails = await Promise.all(
        teamMembers.map(async (member) => {
          const volume = await getTeamVolume(member.child, 1); // Get volume for each member
          return {
            username: member.child?.username || "Unknown",
            level: member.level,
            volume,
          };
        })
      );

      res.json(teamDetails);
    } else if (type === "events") {
      // Get detailed reward events
      const events = await CommunityBoosterReward.find({
        userId: user._id,
        createdAt: { $gte: targetDate.toDate(), $lt: nextDate.toDate() },
      })
        .populate("triggeringUserId", "username")
        .populate("triggeringEventId", "amount ts")
        .sort({ createdAt: -1 })
        .lean();

      const formattedEvents = events.map((event) => ({
        ts: event.createdAt,
        amount: event.amount,
        level: event.level,
        tier: event.tier,
        rate: event.rate,
        from: event.triggeringUserId?.username || "Unknown",
        triggeringAmount: event.triggeringEventId?.amount || "0",
        triggeringDate: event.triggeringEventId?.ts || event.createdAt,
        narrative: event.narrative,
      }));

      res.json(formattedEvents);
    }
  } catch (error) {
    console.error("Error in getBoosterDetails:", error);
    res.status(500).json({ msg: "Server error" });
  }
};

module.exports = {
  getBoosterSummary,
  getBoosterDetails,
  //   getRewardsSummary,
  getActiveDirectsStrict,
  getCascadeSnapshot,
};
