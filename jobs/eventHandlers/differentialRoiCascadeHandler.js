// jobs/eventHandlers/differentialRoiCascadeHandler.js
const mongoose = require("mongoose");
const User = require("../../models/User");
const Level = require("../../models/Level");
const Ledger = require("../../models/Ledger");
const CascadeReward = require("../../models/CascadeReward");
const { Decimal128 } = mongoose.Types;

const {
  getOrCreateLedger /*, createLedgerEntry */,
} = require("../helpers/ledgerHelpers");
const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  compareDecimal128,
} = require("../../utils/decimal128Utils");
const {
  countActiveDirectsBySponsorUhidUsingLedger,
  sumTopNDirectsLpBySponsorUhid,
} = require("../../jobs/helpers/directsLp");

/**
 * Rules per your spec:
 * - Base gates for EVERY level:
 *   a) sponsor has selfLP >= 9 (from Ledger.wallets.lp)
 *   b) sponsor has at least `minDirects` directs with LP > 9 (strict)
 * - Extra gates:
 *   L1-3: only need base + selfLP>=9 (team gate is null)
 *   L4-6: (selfLP >= 1500) OR (teamLp3 sum(top3) >= 7500)
 *   L7-16: (selfLP >= 3000) OR (teamLp5 sum(top5) >= 15000)
 */

// Level rules (as given)

const cascadeUnlockRules = [
  {
    level: 1,
    pct: 0.12,
    minDirects: 1,
    selfLpOrTeamLp3: { selfLp: 9, teamLp3: null },
  },
  {
    level: 2,
    pct: 0.1,
    minDirects: 2,
    selfLpOrTeamLp3: { selfLp: 9, teamLp3: null },
  },
  {
    level: 3,
    pct: 0.07,
    minDirects: 3,
    selfLpOrTeamLp3: { selfLp: 9, teamLp3: null },
  },
  {
    level: 4,
    pct: 0.05,
    minDirects: 4,
    selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 },
  },
  {
    level: 5,
    pct: 0.05,
    minDirects: 5,
    selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 },
  },
  {
    level: 6,
    pct: 0.05,
    minDirects: 5,
    selfLpOrTeamLp3: { selfLp: 1500, teamLp3: 7500 },
  },
  {
    level: 7,
    pct: 0.03,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 },
  },
  {
    level: 8,
    pct: 0.03,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 },
  },
  {
    level: 9,
    pct: 0.03,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 },
  },
  {
    level: 10,
    pct: 0.03,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 3000, teamLp5: 15000 },
  },
  {
    level: 11,
    pct: 0.05,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 },
  },
  {
    level: 12,
    pct: 0.05,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 },
  },
  {
    level: 13,
    pct: 0.05,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 4000, teamLp5: 30000 },
  },
  {
    level: 14,
    pct: 0.07,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 },
  },
  {
    level: 15,
    pct: 0.1,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 },
  },
  {
    level: 16,
    pct: 0.12,
    minDirects: 5,
    selfLpOrTeamLp5: { selfLp: 5000, teamLp5: 50000 },
  },
];
// --- helpers ---

async function checkSponsorUnlockAtLevel(sponsor, rule) {
  // ---- Base gate (strict active directs) ----
  const activeDirectsCount = await countActiveDirectsBySponsorUhidUsingLedger(
    sponsor.uhid,
    9
  );

  // ---- Fetch sponsor self LP ----
  const sLedger = await Ledger.findOne({ userId: sponsor._id })
    .select("wallets.lp")
    .lean();
  const selfLp = Number(sLedger?.wallets?.lp?.toString?.() ?? 0);

  // ---- Base gates ----
  if (activeDirectsCount < rule.minDirects) {
    return {
      qualified: false,
      reason: `Active directs (>9 LP): ${activeDirectsCount}/${rule.minDirects}`,
      selfLp,
      activeDirectsCount,
    };
  }

  if (selfLp < 9) {
    return {
      qualified: false,
      reason: `Base selfLP ${selfLp} < 9`,
      selfLp,
      activeDirectsCount,
    };
  }

  // ---- Level-specific LP gates ----
  if (rule.selfLpOrTeamLp3) {
    if (rule.selfLpOrTeamLp3.teamLp3 === null) {
      // L1–3 → only base + selfLP≥9 required
      return { qualified: true, selfLp, activeDirectsCount };
    }

    // L4–6 extra gate
    const meetsSelf = selfLp >= rule.selfLpOrTeamLp3.selfLp; // e.g. 1500
    const teamLp3Sum = await sumTopNDirectsLpBySponsorUhid(sponsor.uhid, 3);
    const meetsTeam = teamLp3Sum >= rule.selfLpOrTeamLp3.teamLp3; // e.g. 7500

    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp3Sum, activeDirectsCount }
      : {
          qualified: false,
          reason: `Need selfLP>=${rule.selfLpOrTeamLp3.selfLp} OR teamLp3(top3)>=${rule.selfLpOrTeamLp3.teamLp3}; got selfLP=${selfLp}, teamLp3=${teamLp3Sum}`,
          selfLp,
          teamLp3Sum,
          activeDirectsCount,
        };
  }

  if (rule.selfLpOrTeamLp5) {
    // L7–16 extra gate
    const meetsSelf = selfLp >= rule.selfLpOrTeamLp5.selfLp; // e.g. 3000/4000/5000
    const teamLp5Sum = await sumTopNDirectsLpBySponsorUhid(sponsor.uhid, 5);
    const meetsTeam = teamLp5Sum >= rule.selfLpOrTeamLp5.teamLp5; // e.g. 15000/30000/50000

    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp5Sum, activeDirectsCount }
      : {
          qualified: false,
          reason: `Need selfLP>=${rule.selfLpOrTeamLp5.selfLp} OR teamLp5(top5)>=${rule.selfLpOrTeamLp5.teamLp5}; got selfLP=${selfLp}, teamLp5=${teamLp5Sum}`,
          selfLp,
          teamLp5Sum,
          activeDirectsCount,
        };
  }

  return { qualified: false, reason: "No applicable rule for this level.", selfLp, activeDirectsCount };
}

async function SponsorUnlockAtLevel(
  sponsor,
  rule,
  precomputed = {} // <--- accept precomputed values
) {
  const {
    activeDirectsCount,
    selfLp,
    teamLp3Sum,
    teamLp5Sum,
  } = precomputed;

  // ---- Base gates ----
  if (activeDirectsCount < rule.minDirects) {
    return {
      qualified: false,
      reason: `Active directs (>9 LP): ${activeDirectsCount}/${rule.minDirects}`,
      selfLp,
      activeDirectsCount,
    };
  }

  if (selfLp < 9) {
    return {
      qualified: false,
      reason: `Base selfLP ${selfLp} < 9`,
      selfLp,
      activeDirectsCount,
    };
  }

  if (rule.selfLpOrTeamLp3) {
    if (rule.selfLpOrTeamLp3.teamLp3 === null) {
      return { qualified: true, selfLp, activeDirectsCount };
    }

    const meetsSelf = selfLp >= rule.selfLpOrTeamLp3.selfLp;
    const meetsTeam = teamLp3Sum >= rule.selfLpOrTeamLp3.teamLp3;

    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp3Sum, activeDirectsCount }
      : {
          qualified: false,
          reason: `Need selfLP>=${rule.selfLpOrTeamLp3.selfLp} OR teamLp3(top3)>=${rule.selfLpOrTeamLp3.teamLp3}; got selfLP=${selfLp}, teamLp3=${teamLp3Sum}`,
          selfLp,
          teamLp3Sum,
          activeDirectsCount,
        };
  }

  if (rule.selfLpOrTeamLp5) {
    const meetsSelf = selfLp >= rule.selfLpOrTeamLp5.selfLp;
    const meetsTeam = teamLp5Sum >= rule.selfLpOrTeamLp5.teamLp5;

    return meetsSelf || meetsTeam
      ? { qualified: true, selfLp, teamLp5Sum, activeDirectsCount }
      : {
          qualified: false,
          reason: `Need selfLP>=${rule.selfLpOrTeamLp5.selfLp} OR teamLp5(top5)>=${rule.selfLpOrTeamLp5.teamLp5}; got selfLP=${selfLp}, teamLp5=${teamLp5Sum}`,
          selfLp,
          teamLp5Sum,
          activeDirectsCount,
        };
  }

  return { qualified: false, reason: "No applicable rule for this level.", selfLp, activeDirectsCount };
}
async function getUplinesBatch(childUhid, maxDepth = 64) {
  // fetch a batch of ancestors above a child (ascending depth)
  return await Level.find({
    child: childUhid,
    level: { $gte: 1, $lte: maxDepth },
  })
    .sort({ level: 1 })
    .select("parent")
    .lean();
}

// --- main ---

exports.handleDifferentialRoiCascade = async (payload) => {
  const { depositorUserId, depositAmount, triggeringEventId } = payload;
  const depositAmountD128 = Decimal128.fromString(String(depositAmount));

  // Get depositor info
  const depositor = await User.findById(depositorUserId)
    .select("uhid username")
    .lean();
  if (!depositor) throw new Error(`Depositor ${depositorUserId} not found`);

  // 🔎 Pull uplines (L1..L64 just in case, but we only use 16 slots)
  const uplines = await Level.find({
    child: depositor.uhid,
    level: { $gte: 1, $lte: 64 },
  })
    .sort({ level: 1 })
    .lean();

  const uhidList = uplines.map((u) => u.parent);
  const users = await User.find({ uhid: { $in: uhidList } })
    .select("_id uhid username")
    .lean();
  const byUhid = new Map(users.map((u) => [u.uhid, u]));

  const payouts = [];

  // process cascade slots L1–L16
  for (let lvl = 1; lvl <= 16; lvl++) {
    const rule = cascadeUnlockRules.find((r) => r.level === lvl);
    if (!rule) continue;

    let sponsorRecord = uplines.find((u) => u.level === lvl);
    let paid = false;

    // 🔁 compression loop: climb until a qualified sponsor is found
    while (sponsorRecord) {
      const sponsor = byUhid.get(sponsorRecord.parent);
      if (!sponsor) {
        
        // try next higher parent
        sponsorRecord = uplines.find((u) => u.level === sponsorRecord.level + 1);
        continue;
      }

      const q = await checkSponsorUnlockAtLevel(sponsor, rule);
      if (!q.qualified) {
        console.log(
          `L${lvl}: SKIP ${sponsor.username} (${sponsor.uhid}) → ${q.reason}`
        );
        sponsorRecord = uplines.find(
          (u) => u.level === sponsorRecord.level + 1
        );
        continue;
      }

      // ✅ qualified sponsor found → pay them
      const rateD128 = Decimal128.fromString(String(rule.pct));
      let payout = multiplyDecimal128(depositAmountD128, rateD128);

      if (Number(payout.toString()) <= 0) break;

      const sLedger = await getOrCreateLedger(sponsor._id);
      const remaining5x = subtractDecimal128(
        sLedger.limits.fiveXLimit.cap,
        sLedger.limits.fiveXLimit.used
      );
      if (Number(remaining5x.toString()) <= 0) {
        
        sponsorRecord = uplines.find(
          (u) => u.level === sponsorRecord.level + 1
        );
        continue;
      }
      if (compareDecimal128(payout, remaining5x) === 1) payout = remaining5x;
      if (Number(payout.toString()) <= 0) break;

      // credit wallets
      sLedger.wallets.cascadeRewards = addDecimal128(
        sLedger.wallets.cascadeRewards,
        payout
      );
      sLedger.wallets.communityRewards = addDecimal128(
        sLedger.wallets.communityRewards,
        payout
      );
      sLedger.wallets.dailyCascadeRewards = addDecimal128(
        sLedger.wallets.dailyCascadeRewards,
        payout
      );
      sLedger.limits.fiveXLimit.used = addDecimal128(
        sLedger.limits.fiveXLimit.used,
        payout
      );

      const narrative = `Differential Cascade (L${lvl} @ ${
        rule.pct * 100
      }%) from ${depositor.username || depositorUserId}.`;

      await CascadeReward.create([
        {
          userId: sponsor._id,
          triggeringUserId: depositorUserId,
          triggeringEventId,
          amount: payout,
          rate: rateD128,
          narrative,
        },
      ]);

      await sLedger.save();
      console.log(
        `L${lvl}: PAID ${sponsor.username} (${sponsor.uhid}) = ${payout.toString()}`
      );

      payouts.push({
        sponsorUhid: sponsor.uhid,
        sponsorId: sponsor._id,
        sponsorUsername: sponsor.username,
        level: lvl,
        payout: payout.toString(),
        depositor: depositor.uhid,
        depositorId: depositorUserId,
        triggeringEventId,
      });

      paid = true;
      break; // done for this slot
    }

    if (!paid) {
      
    }
  }

  console.log(
    `Cascade finished for ${depositor.username || depositorUserId}. Slots 1–16 checked.`
  );

  return payouts;
};


exports.cascadeUnlockRules = cascadeUnlockRules;
exports.checkSponsorUnlockAtLevel = checkSponsorUnlockAtLevel;
exports.SponsorUnlockAtLevel = SponsorUnlockAtLevel;

