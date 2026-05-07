// scripts/checkCascadeQualifications.js
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ExcelJS = require("exceljs");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const Level = require("../models/Level");

const connectDB = require("../config/db");

// cascade rules
const rules = [
  { level: 1, pct: 0.12, minDirects: 1, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 2, pct: 0.1, minDirects: 2, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 3, pct: 0.07, minDirects: 3, selfLpOrTeamLp3: { selfLp: 9, teamLp3: null } },
  { level: 4, pct: 0.05, minDirects: 4, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 5, pct: 0.05, minDirects: 5, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 6, pct: 0.05, minDirects: 5, selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 } },
  { level: 7, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 8, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 9, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 10, pct: 0.03, minDirects: 5, selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 } },
  { level: 11, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 12, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 13, pct: 0.05, minDirects: 5, selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 } },
  { level: 14, pct: 0.07, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
  { level: 15, pct: 0.1, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
  { level: 16, pct: 0.12, minDirects: 5, selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 } },
];

// your fast sponsor check function
async function SponsorUnlockAtLevel(sponsor, rule, precomputed = {}) {
  const { activeDirectsCount, selfLp, teamLp3Sum, teamLp5Sum } = precomputed;

  if (activeDirectsCount < rule.minDirects) {
    return { qualified: false, reason: `Active directs (>9 LP): ${activeDirectsCount}/${rule.minDirects}`, selfLp, activeDirectsCount };
  }

  if (selfLp < 9) {
    return { qualified: false, reason: `Base selfLP ${selfLp} < 9`, selfLp, activeDirectsCount };
  }

  if (rule.selfLpOrTeamLp3) {
    if (rule.selfLpOrTeamLp3.teamLp3 === null) {
      return { qualified: true, selfLp, activeDirectsCount };
    }
    const meetsSelf = selfLp >= rule.selfLpOrTeamLp3.selfLp;
    const meetsTeam = teamLp3Sum >= rule.selfLpOrTeamLp3.teamLp3;
    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp3Sum, activeDirectsCount }
      : { qualified: false, reason: `Need selfLP>=${rule.selfLpOrTeamLp3.selfLp} OR teamLp3(top3)>=${rule.selfLpOrTeamLp3.teamLp3}; got selfLP=${selfLp}, teamLp3=${teamLp3Sum}`, selfLp, teamLp3Sum, activeDirectsCount };
  }

  if (rule.selfLpOrTeamLp5) {
    const meetsSelf = selfLp >= rule.selfLpOrTeamLp5.selfLp;
    const meetsTeam = teamLp5Sum >= rule.selfLpOrTeamLp5.teamLp5;
    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp5Sum, activeDirectsCount }
      : { qualified: false, reason: `Need selfLP>=${rule.selfLpOrTeamLp5.selfLp} OR teamLp5(top5)>=${rule.selfLpOrTeamLp5.teamLp5}; got selfLP=${selfLp}, teamLp5=${teamLp5Sum}`, selfLp, teamLp5Sum, activeDirectsCount };
  }

  return { qualified: false, reason: "No applicable rule for this level.", selfLp, activeDirectsCount };
}

/**
 * Precompute stats (selfLp, directs, teamLp3, teamLp5) for all sponsors
 */
async function getSponsorStats() {
  const agg = await Level.aggregate([
    { $match: { level: { $lte: 5 } } },
    {
      $lookup: { from: "users", localField: "child", foreignField: "uhid", as: "childUser" },
    },
    { $unwind: "$childUser" },
    {
      $lookup: { from: "ledgers", localField: "childUser._id", foreignField: "userId", as: "childLedger" },
    },
    { $unwind: { path: "$childLedger", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        parent: 1,
        level: 1,
        childLp: { $toDouble: { $ifNull: ["$childLedger.wallets.lp", 0] } },
      },
    },
    {
      $group: {
        _id: { parent: "$parent", level: "$level" },
        totalLp: { $sum: "$childLp" },
        activeDirectsAtLevel: { $sum: { $cond: [{ $gt: ["$childLp", 9] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: "$_id.parent",
        perLevel: { $push: { level: "$_id.level", totalLp: "$totalLp", activeDirectsAtLevel: "$activeDirectsAtLevel" } },
      },
    },
    {
      $project: {
        teamLp3Sum: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $lte: ["$$lvl.level", 3] }, "$$lvl.totalLp", 0] },
            },
          },
        },
        teamLp5Sum: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $lte: ["$$lvl.level", 5] }, "$$lvl.totalLp", 0] },
            },
          },
        },
        activeDirectsCount: {
          $sum: {
            $map: {
              input: "$perLevel",
              as: "lvl",
              in: { $cond: [{ $eq: ["$$lvl.level", 1] }, "$$lvl.activeDirectsAtLevel", 0] },
            },
          },
        },
      },
    },
  ]);

  const statsMap = new Map();
  for (const doc of agg) {
    statsMap.set(doc._id, {
      activeDirectsCount: doc.activeDirectsCount || 0,
      teamLp3Sum: doc.teamLp3Sum || 0,
      teamLp5Sum: doc.teamLp5Sum || 0,
    });
  }

  const uhids = Array.from(statsMap.keys());
  const users = await User.find({ uhid: { $in: uhids } }).select("_id uhid username").lean();
  const userByUhid = new Map(users.map((u) => [u.uhid, u]));
  const userIds = users.map((u) => u._id);

  const ledgers = await Ledger.find({ userId: { $in: userIds } }).select("userId wallets.lp").lean();
  const ledgerById = new Map(ledgers.map((l) => [String(l.userId), l]));
  const idByUhid = new Map(users.map((u) => [u.uhid, String(u._id)]));

  for (const [uhid, stats] of statsMap.entries()) {
    const uid = idByUhid.get(uhid);
    const ledger = ledgerById.get(uid);
    const selfLp = ledger?.wallets?.lp ? Number(ledger.wallets.lp.toString()) : 0;
    statsMap.set(uhid, { ...stats, selfLp });
  }

  return { statsMap, userByUhid };
}

async function run() {
  await connectDB();
  

  const { statsMap, userByUhid } = await getSponsorStats();
  const results = [];

  for (const [sponsorUhid, stats] of statsMap.entries()) {
    let highestLevelUnlocked = 0;
    let reason = "";

    const user = userByUhid.get(sponsorUhid);
    if (!user) continue;

    for (const rule of rules) {
      const res = await SponsorUnlockAtLevel(user, rule, stats);

      if (res.qualified) {
        highestLevelUnlocked = rule.level;
      } else {
        reason = res.reason || "";
        break;
      }
    }

    results.push({
      sponsorUhid,
      username: user.username,
      selfLp: stats.selfLp,
      activeDirectsCount: stats.activeDirectsCount,
      teamLp3Sum: stats.teamLp3Sum,
      teamLp5Sum: stats.teamLp5Sum,
      highestLevelUnlocked,
      reason,
    });
  }

  results.sort((a, b) => b.highestLevelUnlocked - a.highestLevelUnlocked);

  const reportsDir = path.join(__dirname, "../reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CascadeQualification");

  ws.columns = [
    { header: "Sponsor UHID", key: "sponsorUhid", width: 20 },
    { header: "Username", key: "username", width: 22 },
    { header: "Self LP", key: "selfLp", width: 12 },
    { header: "Active Directs", key: "activeDirectsCount", width: 16 },
    { header: "Team LP3 Sum (L1-L3)", key: "teamLp3Sum", width: 20 },
    { header: "Team LP5 Sum (L1-L5)", key: "teamLp5Sum", width: 20 },
    { header: "Highest Level Unlocked", key: "highestLevelUnlocked", width: 24 },
    { header: "Reason", key: "reason", width: 60 },
  ];

  ws.addRows(results);

  const outFile = path.join(reportsDir, "cascade_qualifications.xlsx");
  await wb.xlsx.writeFile(outFile);
  

  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error("Fatal error:", e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
