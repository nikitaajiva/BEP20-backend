const mongoose = require('mongoose');
const User = require('../../models/User');
const Level = require('../../models/Level');
const Ledger = require('../../models/Ledger');
const LedgerRow = require('../../models/LedgerRow');
const X1Reward = require('../../models/X1Reward');
const { meetsTeamVolumeRequirement, getDirectChildrenCount } = require('../../utils/teamUtils');
const { 
    addDecimal128, 
    multiplyDecimal128, 
    ensureDecimal128,
    compareDecimal128,
    subtractDecimal128
} = require('../../utils/decimal128Utils');
const XrpDeposit = require('../../models/XrpDeposit');

// Add logging function
const logX1Check = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [X1Handler] ${message}`);
};

// X1-X5 Tiers Configuration
const X_TIERS = {
    X: {
        selfLP: 1000,
        teamLP: 15000,
        rate: 0.10
    },
    X1: {
        selfLP: 1500,
        teamLP: 30000,
        rate: 0.20
    },
    X2: {
        selfLP: 3000,
        teamLP: 120000,
        rate: 0.25
    },
    X3: {
        selfLP: 6000,
        teamLP: 300000,
        rate: 0.30
    },
    X4: {
        selfLP: 12000,
        teamLP: 900000,
        rate: 0.40
    },
    X5: {
        selfLP: 20000,
        teamLP: 1500000,
        rate: 0.50
    }
};

const MAX_TOTAL_RATE = 0.50; // Maximum 50% total distribution
const LEVELS_PER_BATCH = 16; // Number of levels to fetch in each batch

/**
 * Get user's qualification tier based on their LP and team LP
 */

// Config
const XRANKS = [
  { code: "X",  level: 0, reqSelf: 1000, reqCommunity: 15000,  rate: 0.10 },
  { code: "X1", level: 1, reqSelf: 1500,  reqCommunity: 30000,  rate: 0.20 },
  { code: "X2", level: 2, reqSelf: 3000,  reqCommunity: 120000, rate: 0.25 },
  { code: "X3", level: 3, reqSelf: 6000,  reqCommunity: 300000, rate: 0.30 },
  { code: "X4", level: 4, reqSelf: 12000, reqCommunity: 900000, rate: 0.40 },
  { code: "X5", level: 5, reqSelf: 20000, reqCommunity: 1500000, rate: 0.50 },
];

// Utils
const d2n = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (v.$numberDecimal) return parseFloat(v.$numberDecimal) || 0;
  try { return parseFloat(v.toString()); } catch { return 0; }
};

const fmt = (n, d = 3) => Number(d2n(n)).toFixed(d);
function normalizeRank(val) {
  if (!val) return "";
  return String(val).toUpperCase().trim();
}

// Helpers
async function getUserByUHID(uhid) {
  return User.findOne(
    { uhid },
    { _id: 1, uhid: 1, username: 1, xRank: 1, xrank: 1, "counters.totalTeamLp": 1 }
  ).lean();
}
async function getSelfLpByUserId(userId) {
  const led = await Ledger.findOne({ userId }, { "wallets.lp": 1 }).lean();
  return d2n(led?.wallets?.lp);
}
function getTeamLpFromUserDoc(userDoc) {
  return d2n(userDoc?.counters?.totalTeamLp ?? 0);
}
async function getChildrenForLevel(parentUhid, lvl) {
  const rows = await Level.find({ parent: parentUhid, level: lvl }).lean();
  return rows.map(r => r.child).filter(Boolean);
}
async function getAllChildrenAnyLevel(parentUhid) {
  const rows = await Level.find({ parent: parentUhid }, { child: 1 }).lean();
  const set = new Set(rows.map(r => r.child).filter(Boolean));
  return Array.from(set);
}
async function buildChildRankCounts(parentUhid) {
  const allChildren = await getAllChildrenAnyLevel(parentUhid);
  const counts = { X: 0, X1: 0, X2: 0, X3: 0, X4: 0, X5: 0 };
  if (allChildren.length === 0) return counts;

  const childUsers = await User.find(
    { uhid: { $in: allChildren } },
    { uhid: 1, xRank: 1, xrank: 1 }
  ).lean();

  childUsers.forEach(u => {
    const r = normalizeRank(u.xRank || u.xrank);
    if (counts[r] !== undefined) counts[r] += 1;
  });
  return counts;
}

// Build leg results with ranks
async function buildLegRankMap(parentUhid) {
  const directLegs = await Level.find({ parent: parentUhid, level: 1 }).lean();
  const legRoots = directLegs.map(r => r.child);

  const legResults = [];

  for (const root of legRoots) {
    const teamUhids = await getAllChildrenAnyLevel(root);
    teamUhids.push(root);

    const users = await User.find(
      { uhid: { $in: teamUhids } },
      { uhid: 1, username: 1, xRank: 1, xrank: 1 }
    ).lean();

    const rankSet = new Set();
    users.forEach(u => {
      const r = normalizeRank(u.xRank || u.xrank);
      if (["X","X1","X2","X3","X4","X5"].includes(r)) {
        rankSet.add(r);
      }
    });

    legResults.push({ root, ranks: Array.from(rankSet), users });
  }

  return legResults;
}

function checkAutoQual(rankCode, legResults, parentSelfLP) {
  if (parentSelfLP < 1500) {
    return { autoPass: false, reason: `Parent Self LP ${fmt(parentSelfLP)} < 1500` };
  }

  let targetRank = null;
  if (rankCode === "X2") targetRank = "X1";
  if (rankCode === "X3") targetRank = "X2";
  if (rankCode === "X4") targetRank = "X3";
  if (rankCode === "X5") targetRank = "X4";

  if (!targetRank) return { autoPass: false, reason: "" };

  const qualifyingLegs = legResults.filter(leg => leg.ranks.includes(targetRank));

  return {
    autoPass: qualifyingLegs.length >= 3,
    reason: `Found ${qualifyingLegs.length} legs with at least one ${targetRank}`,
    qualifyingLegs
  };
}



// ---- Main Qualification Function ----
// ---- Main Qualification Function ----
async function getUserQualificationTier(uhid) {
  const parent = await getUserByUHID(uhid);
  if (!parent) {
    logX1Check(`❌ UHID ${uhid} not found`);
    return { tier: null, rate: 0 };
  }

  const parentSelfLP = await getSelfLpByUserId(parent._id);
  const legResults = await buildLegRankMap(parent.uhid);


  logX1Check(`Checking ranks for ${parent.username || "N/A"} (UHID: ${parent.uhid})`);
  logX1Check(`- Self LP: ${fmt(parentSelfLP)}`);
  // logX1Check(`- Child Rank Counts: ${JSON.stringify(childRankCounts)}`);

  let highest = null;
  for (const rank of XRANKS) {
  console.log(`--- ${rank.code} ---`);
  const { autoPass, reason, qualifyingLegs } = checkAutoQual(rank.code, legResults, parentSelfLP);

  if (autoPass) {
    console.log(`✅ QUALIFIED ${rank.code}`);
    console.log(`   Reason: ${reason}`);
    // show legs & users
    qualifyingLegs.forEach((leg, i) => {
      console.log(`   Leg ${i+1} (root ${leg.root}) contributed:`);
      leg.users
        .filter(u => normalizeRank(u.xRank || u.xrank) === (
          rank.code === "X2" ? "X1" :
          rank.code === "X3" ? "X2" :
          rank.code === "X4" ? "X3" : "X4"
        ))
        .forEach(u => console.log(`      - ${u.uhid} (${u.username})`));
    });
    highest = rank.code;
    continue; // go to next rank
  } else if (reason) {
    console.log(`❌ Auto rule failed: ${reason}`);
    // ⚠️ DO NOT skip here → fall through to manual check below
  }

  // --- manual qualification path ---
  const selfOk = parentSelfLP >= rank.reqSelf;

  const childUhids = await getChildrenForLevel(parent.uhid, 1);
  const maxContributionPerChild = rank.reqCommunity / 3;

  let totalCommunity = 0;
  let legContributions = [];

  for (const cUhid of childUhids) {
    const u = await getUserByUHID(cUhid);
    if (!u) continue;
    const self = await getSelfLpByUserId(u._id);
    const team = getTeamLpFromUserDoc(u);
    const childTotal = self + team;
    const capped = Math.min(childTotal, maxContributionPerChild);

    totalCommunity += capped;
    legContributions.push({
      uhid: cUhid,
      username: u.username || "N/A",
      self: fmt(self),
      team: fmt(team),
      total: fmt(childTotal),
      capped: fmt(capped),
    });
  }

  const communityOk = totalCommunity >= rank.reqCommunity;

  if (selfOk && communityOk) {
   console.log(`✅ QUALIFIED ${rank.code}`);
   console.log(`   Reason: Self LP ${fmt(parentSelfLP)} ≥ ${rank.reqSelf} AND Community LP ${fmt(totalCommunity)} ≥ ${rank.reqCommunity}`);
   console.log("   Breakdown per leg (capped at 1/3 rule):");
    legContributions.forEach((leg, i) => {
      console.log(`     Leg ${i+1} (${leg.uhid} - ${leg.username}): Self=${leg.self}, Team=${leg.team}, Total=${leg.total}, Counted=${leg.capped}`);
    });
    highest = rank.code;
  } else {

    // --- NEW SPECIAL RULE CHECK BEFORE FAILING ---
const maxCap = rank.reqCommunity / 3;
const minLegValue = maxCap / 3;   // allow small legs also
const cappedLegs = legContributions.filter(x => d2n(x.capped) >= maxCap);
const remainingLegs = legContributions.filter(x => d2n(x.capped) < maxCap);

// Rule: If 2 legs are maxed AND remaining legs are >= minLegValue → qualify
if (cappedLegs.length >= 2) {
    const remainingAreGood = remainingLegs.every(
        x => d2n(x.capped) >= minLegValue
    );

    if (remainingAreGood) {
        console.log(`✅ SPECIAL RULE QUALIFIED ${rank.code}`);
        console.log(`   Reason: Two legs reached cap (${maxCap}), and remaining legs have acceptable volume (>= ${minLegValue})`);
        legContributions.forEach((leg, i) => {
            console.log(`     Leg ${i+1} (${leg.uhid} - ${leg.username}): Self=${leg.self}, Team=${leg.team}, Total=${leg.total}, Counted=${leg.capped}`);
        });
        highest = rank.code;
        continue;
    }
}


   console.log(`❌ NOT QUALIFIED ${rank.code}`);
  console.log(`   Failed because: Self LP ${fmt(parentSelfLP)} vs Req ${rank.reqSelf}, Community LP ${fmt(totalCommunity)} vs Req ${rank.reqCommunity}`);
 console.log("   Breakdown per leg (capped at 1/3 rule):");
    legContributions.forEach((leg, i) => {
     console.log(`     Leg ${i+1} (${leg.uhid} - ${leg.username}): Self=${leg.self}, Team=${leg.team}, Total=${leg.total}, Counted=${leg.capped}`);
    });
    console.log(`⛔ Stopping script for ${parent.uhid} at ${rank.code}`);
    break;
  }
}

  if (highest) {
    logX1Check(`🎯 Final Rank for ${parent.uhid} = ${highest}`);
    return { tier: highest, rate: highest.rate };
  } else {
    logX1Check(`❌ ${parent.uhid} did not qualify for any rank`);
    return { tier: null, rate: 0 };
  }
}



/**
 * Get batch of upline levels starting from a specific UHID
 */
async function getUplineBatch(startingUhid) {
    const levels = await Level.find({ 
        child: startingUhid,
        level: { $lte: LEVELS_PER_BATCH }
    })
    .sort('level')
    .populate('parent')
    .lean();

    return levels;
}

/**
 * Get all uplines in sequence with their qualification tiers
 */
async function getQualifiedUplineChain(startingUhid) {
    const uplineChain = [];
    let currentUhid = startingUhid;
    let processedLevels = 0;

    while (currentUhid) {
        // Get batch of up to 16 levels
        const levelsBatch = await getUplineBatch(currentUhid);
        if (!levelsBatch || levelsBatch.length === 0) break;

        // Process each level in the batch
        for (const level of levelsBatch) {
            if (!level.parent) continue;

            const uplineUser = await User.findOne({ uhid: level.parent }).lean();
            if (!uplineUser) continue;

            const qualification = await getUserQualificationTier(uplineUser.uhid);
            logX1Check(`Upline ${uplineUser.username} is qualified for : ${qualification.tier}`);
            if (qualification.tier) {
                uplineChain.push({
                    user: uplineUser,
                    qualification,
                    level: processedLevels + level.level
                });
            }
        }

        // Set up for next batch if needed
        const lastLevel = levelsBatch[levelsBatch.length - 1];
        if (!lastLevel || !lastLevel.parent) break;

        currentUhid = lastLevel.parent;
        processedLevels += LEVELS_PER_BATCH;
    }

    return uplineChain;
}

/**
 * Award X bonus to an upline
 */
async function awardXBonus(uplineUser, depositor, depositAmount, rate, triggeringEventId, tier, level) {
    const depositAmountD128 = ensureDecimal128(depositAmount);
    const rateD128 = ensureDecimal128(rate.toString());
    const bonusAmount = multiplyDecimal128(depositAmountD128, rateD128);

    logX1Check(`Processing bonus for ${uplineUser.username} (UHID: ${uplineUser.uhid})`);
    logX1Check(`- Tier: ${tier}`);
    logX1Check(`- Rate: ${(rate * 100).toFixed(1)}%`);
    logX1Check(`- Level: ${level}`);
    logX1Check(`- Deposit Amount: ${depositAmount} XRP`);
    logX1Check(`- Bonus Amount: ${bonusAmount.toString()} XRP`);

    // Store reward in X1Reward collection
    await X1Reward.create({
        userId: uplineUser._id,
        depositorId: depositor._id,
        amount: bonusAmount,
        tier,
        rate,
        level,
        depositAmount: depositAmountD128,
        triggeringEventId,
        ts: new Date()
    });

    // Update upline's ledger
    const uplineLedger = await Ledger.findOne({ userId: uplineUser._id });
    if (uplineLedger) {
        uplineLedger.wallets.xBonus = addDecimal128(
            ensureDecimal128(uplineLedger.wallets.xBonus || '0'),
            bonusAmount
        );
        uplineLedger.wallets.communityRewards = addDecimal128(
            ensureDecimal128(uplineLedger.wallets.communityRewards || '0'),
            bonusAmount
        );
        uplineLedger.wallets.dailyXBonus = addDecimal128(
            ensureDecimal128(uplineLedger.wallets.dailyXBonus || '0'),
            bonusAmount
        );
        // Increment the ledger's aggregate total rewards tally
        uplineLedger.totalRewardsCredited = addDecimal128(
            ensureDecimal128(uplineLedger.totalRewardsCredited || '0'),
            bonusAmount
        )
        uplineLedger.limits.fiveXLimit.used = addDecimal128(
            ensureDecimal128(uplineLedger.limits.fiveXLimit.used || '0'),
            bonusAmount
        );
        await uplineLedger.save();
    }

    console.log(`[X1Handler] Awarded ${bonusAmount.toString()} XRP to ${uplineUser.username} (${tier} at ${(rate * 100).toFixed(1)}%, Level ${level})`);
    
    return parseFloat(rate);
}

/**
 * Processes X1-X5 rewards when a user makes an LP deposit
 */
const handleX1 = async (payload) => {
    const { depositorUserId, depositAmount, triggeringEventId } = payload;

    try {
        logX1Check(`Starting X1-X5 bonus processing for deposit: ${depositAmount} XRP`);
        
        // Get the depositor's info
        const depositor = await User.findById(depositorUserId).lean();
        if (!depositor) {
            logX1Check(`❌ Depositor ${depositorUserId} not found`);
            return;
        }

        logX1Check(`Processing deposit from ${depositor.username} (UHID: ${depositor.uhid})`);

        // Get all qualified uplines in sequence
        const qualifiedUplines = await getQualifiedUplineChain(depositor.uhid);
        if (qualifiedUplines.length === 0) {
            logX1Check(`❌ No qualified uplines found for ${depositor.username}`);
            return;
        }

        logX1Check(`Found ${qualifiedUplines.length} qualified uplines`);
        let totalRateDistributed = 0;

        // First upline gets their full rate
        const firstUpline = qualifiedUplines[0];
        logX1Check(`Processing first upline ${firstUpline.user.username} with full rate ${(firstUpline.qualification.rate * 100).toFixed(1)}%`);
        
        totalRateDistributed += await awardXBonus(
            firstUpline.user,
            depositor,
            depositAmount,
            firstUpline.qualification.rate,
            triggeringEventId,
            firstUpline.qualification.tier,
            firstUpline.level
        );

        // Process remaining uplines with differential rates
        for (let i = 1; i < qualifiedUplines.length; i++) {
            const currentUpline = qualifiedUplines[i];
            const prevUpline = qualifiedUplines[i - 1];

            // Calculate differential rate
            const differential = Math.max(0, currentUpline.qualification.rate - prevUpline.qualification.rate);
            
            logX1Check(`Processing upline ${currentUpline.user.username}:`);
            logX1Check(`- Current rate: ${(currentUpline.qualification.rate * 100).toFixed(1)}%`);
            logX1Check(`- Previous rate: ${(prevUpline.qualification.rate * 100).toFixed(1)}%`);
            logX1Check(`- Differential: ${(differential * 100).toFixed(1)}%`);
            logX1Check(`- Total distributed so far: ${(totalRateDistributed * 100).toFixed(1)}%`);

            // Check if adding this differential would exceed max total rate
            if (totalRateDistributed + differential > MAX_TOTAL_RATE) {
                const remainingRate = MAX_TOTAL_RATE - totalRateDistributed;
                if (remainingRate > 0) {
                    logX1Check(`⚠️ Capping rate at ${(remainingRate * 100).toFixed(1)}% to not exceed maximum ${(MAX_TOTAL_RATE * 100).toFixed(1)}%`);
                    await awardXBonus(
                        currentUpline.user,
                        depositor,
                        depositAmount,
                        remainingRate,
                        triggeringEventId,
                        currentUpline.qualification.tier,
                        currentUpline.level
                    );
                }
                logX1Check(`Reached maximum total rate of ${(MAX_TOTAL_RATE * 100).toFixed(1)}%. Stopping distribution.`);
                break;
            }

            // Award differential bonus
            if (differential > 0) {
                totalRateDistributed += await awardXBonus(
                    currentUpline.user,
                    depositor,
                    depositAmount,
                    differential,
                    triggeringEventId,
                    currentUpline.qualification.tier,
                    currentUpline.level
                );
            } else {
                logX1Check(`Skipping ${currentUpline.user.username} - No differential bonus (same or lower rate than previous upline)`);
            }

            // Stop if we've reached maximum total rate
            if (totalRateDistributed >= MAX_TOTAL_RATE) {
                logX1Check(`Reached maximum total rate of ${(MAX_TOTAL_RATE * 100).toFixed(1)}%. Stopping distribution.`);
                break;
            }
        }

        logX1Check(`✓ Completed X1-X5 bonus distribution. Total rate distributed: ${(totalRateDistributed * 100).toFixed(1)}%`);

    } catch (error) {
        logX1Check(`❌ Error processing X bonus rewards: ${error.message}`);
        console.error('[X1Handler] Error stack:', error.stack);
        throw error;
    }
};

/**
 * Processes X1-X5 rewards using pre-calculated ranks
 */
const handleX1WithStoredRanks = async ({ depositor, qualifiedUplines, depositAmount, triggeringEventId }) => {
    try {
        logX1Check(`Starting X1-X5 bonus processing for deposit: ${depositAmount} XRP using stored ranks`);

        
        
        if (qualifiedUplines.length === 0) {
            logX1Check(`❌ No qualified uplines found for ${depositor.username}`);
            return;
        }

        logX1Check(`Found ${qualifiedUplines.length} qualified uplines`);
        let totalRateDistributed = 0;

        // First upline gets their full rate
        const firstUpline = qualifiedUplines[0];
        logX1Check(`Processing first upline ${firstUpline.user.username} with full rate ${(firstUpline.qualification.rate * 100).toFixed(1)}%`);
        
        totalRateDistributed += await awardXBonus(
            firstUpline.user,
            depositor,
            depositAmount,
            firstUpline.qualification.rate,
            triggeringEventId,
            firstUpline.qualification.tier,
            firstUpline.level
        );

        // Process remaining uplines with differential rates
        for (let i = 1; i < qualifiedUplines.length; i++) {
            const currentUpline = qualifiedUplines[i];
            const prevUpline = qualifiedUplines[i - 1];

            // Calculate differential rate
            const differential = Math.max(0, currentUpline.qualification.rate - prevUpline.qualification.rate);
            
            logX1Check(`Processing upline ${currentUpline.user.username}:`);
            logX1Check(`- Current rate: ${(currentUpline.qualification.rate * 100).toFixed(1)}%`);
            logX1Check(`- Previous rate: ${(prevUpline.qualification.rate * 100).toFixed(1)}%`);
            logX1Check(`- Differential: ${(differential * 100).toFixed(1)}%`);
            logX1Check(`- Total distributed so far: ${(totalRateDistributed * 100).toFixed(1)}%`);

            // Check if adding this differential would exceed max total rate
            if (totalRateDistributed + differential > MAX_TOTAL_RATE) {
                const remainingRate = MAX_TOTAL_RATE - totalRateDistributed;
                if (remainingRate > 0) {
                    logX1Check(`⚠️ Capping rate at ${(remainingRate * 100).toFixed(1)}% to not exceed maximum ${(MAX_TOTAL_RATE * 100).toFixed(1)}%`);
                    await awardXBonus(
                        currentUpline.user,
                        depositor,
                        depositAmount,
                        remainingRate,
                        triggeringEventId,
                        currentUpline.qualification.tier,
                        currentUpline.level
                    );
                }
                logX1Check(`Reached maximum total rate of ${(MAX_TOTAL_RATE * 100).toFixed(1)}%. Stopping distribution.`);
                break;
            }

            // Award differential bonus
            if (differential > 0) {
                totalRateDistributed += await awardXBonus(
                    currentUpline.user,
                    depositor,
                    depositAmount,
                    differential,
                    triggeringEventId,
                    currentUpline.qualification.tier,
                    currentUpline.level
                );
            } else {
                logX1Check(`Skipping ${currentUpline.user.username} - No differential bonus (same or lower rate than previous upline)`);
            }

            // Stop if we've reached maximum total rate
            if (totalRateDistributed >= MAX_TOTAL_RATE) {
                logX1Check(`Reached maximum total rate of ${(MAX_TOTAL_RATE * 100).toFixed(1)}%. Stopping distribution.`);
                break;
            }
        }

        logX1Check(`✓ Completed X1-X5 bonus distribution. Total rate distributed: ${(totalRateDistributed * 100).toFixed(1)}%`);

    } catch (error) {
        logX1Check(`❌ Error processing X bonus rewards: ${error.message}`);
        console.error('[X1Handler] Error stack:', error.stack);
        throw error;
    }
};

function getTodayAtUTC0005() {
  const d = new Date();
  d.setUTCHours(0, 5, 0, 0); // 00:05:00.000 UTC
  return d;
}

async function awardXBonus_StoreOnly({
  uplineUser,
  depositor,
  depositAmount,
  rate,
  triggeringEventId,
  tier,
  level,
  eventTs
}) {
  const depositAmountD128 = ensureDecimal128(depositAmount);
  const rateD128 = ensureDecimal128(rate.toString());
  const bonusAmount = multiplyDecimal128(depositAmountD128, rateD128);
const rewardTs = getTodayAtUTC0005();
  await X1Reward.create({
    userId: uplineUser._id,
    depositorId: depositor._id,
    amount: bonusAmount,
    tier,
    rate,
    level,
    depositAmount: depositAmountD128,
    triggeringEventId,
    ts: rewardTs,               // 🔴 IMPORTANT: preserve original day
    postedToLedger: false      // 🔴 NEW FLAG
  });

  return rate;
}

module.exports = {
    handleX1,
    handleX1WithStoredRanks,
    getUserQualificationTier,
    awardXBonus_StoreOnly,
    X_TIERS
}; 
