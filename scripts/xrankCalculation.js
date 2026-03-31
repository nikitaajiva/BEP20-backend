/*
  X-Rank Qualification (by UHID) + Team Auto-Qualification
  --------------------------------------------------------
  Usage:
    node scripts/xrankCalculation.js <UHID>   -> runs for that one UHID
    node scripts/xrankCalculation.js          -> runs for all users with LP > 0

  Collections used:
    - users   : { _id, uhid, username, xRank (or xrank), counters.totalTeamLp }
    - ledgers : { userId, wallets.lp (Decimal128) }
    - levels  : { parent:<UHID>, child:<UHID>, level:Number }

  Auto-qualification rules:
    X1 ≥ 3  -> qualifies X2
    X2 ≥ 3  -> qualifies X3
    X3 ≥ 3  -> qualifies X4
    X4 ≥ 3  -> qualifies X5
    **But only if parent Self LP ≥ 1500**
*/

require("dotenv").config();
const mongoose = require("mongoose");

async function buildLegRankMap(parentUhid) {
  // Step 1: find direct children (legs)
  const directLegs = await Level.find({ parent: parentUhid, level: 1 }).lean();
  const legRoots = directLegs.map(r => r.child);

  const legResults = [];

  for (const root of legRoots) {
    // Step 2: get all downline under this root
    const teamUhids = await getAllChildrenAnyLevel(root);
    teamUhids.push(root); // include the root itself

    // Step 3: fetch their ranks
    const users = await User.find(
      { uhid: { $in: teamUhids } },
      { uhid: 1, username: 1, xRank: 1, xrank: 1 }
    ).lean();

    const rankSet = new Set();
    users.forEach(u => {
      const r = normalizeRank(u.xRank || u.xrank);
      if (["X1","X2","X3","X4","X5"].includes(r)) {
        rankSet.add(r);
      }
    });

    legResults.push({
      root,
      ranks: Array.from(rankSet),
      users
    });
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


async function getTeamLpBreakdown(parentUhid) {
  const result = {};
  for (let lvl = 1; lvl <= 5; lvl++) {
    const children = await getChildrenForLevel(parentUhid, lvl);
    let lvlTotal = 0;

    for (const cUhid of children) {
      const u = await getUserByUHID(cUhid);
      if (!u) continue;
      const self = await getSelfLpByUserId(u._id);
      const team = getTeamLpFromUserDoc(u);
      lvlTotal += self + team;
    }

    result[`L${lvl}`] = lvlTotal;
  }
  return result;
}


// your existing models/connect
const connectDB = require("../config/db");
const User = require("../models/User");
const Ledger = require("../models/Ledger");

// Minimal Level model
const levelSchema = new mongoose.Schema(
  { parent: String, child: String, level: Number },
  { collection: "levels", strict: false }
);
const Level = mongoose.models.Level || mongoose.model("Level", levelSchema);

// ---- Config ----
const CHILD_FIELD = "child";
const XRANKS = [
  { code: "X1", level: 1, reqSelf: 1500,  reqCommunity: 30000 },
  { code: "X2", level: 2, reqSelf: 3000,  reqCommunity: 120000 },
  { code: "X3", level: 3, reqSelf: 6000,  reqCommunity: 300000 },
  { code: "X4", level: 4, reqSelf: 12000, reqCommunity: 900000 },
  { code: "X5", level: 5, reqSelf: 20000, reqCommunity: 1500000 },
];

// ---- Helpers ----
const d2n = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (v.$numberDecimal) return parseFloat(v.$numberDecimal) || 0;
  try { return parseFloat(v.toString()); } catch { return 0; }
};

const fmt = (n, d = 3) => Number(d2n(n)).toFixed(d);

async function getSelfLpByUserId(userId) {
  const led = await Ledger.findOne({ userId }, { "wallets.lp": 1 }).lean();
  return d2n(led?.wallets?.lp);
}

async function getUserByUHID(uhid) {
  return User.findOne(
    { uhid },
    { _id: 1, uhid: 1, username: 1, xRank: 1, xrank: 1,
      "counters.totalTeamLp": 1,
      "counter.totalTeamLp": 1 } // fallback
  ).lean();
}

function getTeamLpFromUserDoc(userDoc) {
  return d2n(
    userDoc?.counters?.totalTeamLp ??
    userDoc?.counter?.totalTeamLp ??
    0
  );
}

async function getChildrenForLevel(parentUhid, lvl) {
  const rows = await Level.find({ parent: parentUhid, level: lvl }).lean();
  return rows.map((r) => r[CHILD_FIELD]).filter(Boolean);
}

async function getAllChildrenAnyLevel(parentUhid) {
  const rows = await Level.find({ parent: parentUhid }, { [CHILD_FIELD]: 1 }).lean();
  const set = new Set(rows.map((r) => r[CHILD_FIELD]).filter(Boolean));
  return Array.from(set);
}

function normalizeRank(val) {
  if (!val) return "";
  return String(val).toUpperCase().trim();
}

// Build rank counts for ALL children
// Build rank counts + details for ALL children
// Build rank counts + details for ALL children
async function buildChildRankCounts(parentUhid) {
  const rows = await Level.find(
    { parent: parentUhid },
    { child: 1, level: 1 }
  ).lean();

  const childMap = {};
  rows.forEach(r => {
    if (r.child) childMap[r.child] = r.level;
  });

  const allChildren = Object.keys(childMap);
  const counts = { X1: 0, X2: 0, X3: 0, X4: 0, X5: 0 };
  const details = { X1: [], X2: [], X3: [], X4: [], X5: [] };

  if (allChildren.length === 0) return { counts, details };

  const childUsers = await User.find(
    { uhid: { $in: allChildren } },
    { uhid: 1, username: 1, xRank: 1, xrank: 1 }
  ).lean();

  for (const u of childUsers) {
    const r = normalizeRank(u.xRank || u.xrank);
    if (counts[r] !== undefined) {
      counts[r] += 1;
      details[r].push({
        uhid: u.uhid,
        username: u.username || "N/A",
        leg: `L${childMap[u.uhid] || "?"}`
      });
    }
  }
  return { counts, details };
}


// ---- Auto Qualification ----
function autoQualForRank(rankCode, counts, parentSelfLP) {
  if (parentSelfLP < 1500) {
    return { autoPass: false, reason: `Parent Self LP ${fmt(parentSelfLP)} < 1500` };
  }
  

  switch (rankCode) {
    case "X2": return { autoPass: counts.X1 >= 3, reason: `Have ${counts.X1} X1 (>=3)` };
    case "X3": return { autoPass: counts.X2 >= 3, reason: `Have ${counts.X2} X2 (>=3)` };
    case "X4": return { autoPass: counts.X3 >= 3, reason: `Have ${counts.X3} X3 (>=3)` };
    case "X5": return { autoPass: counts.X4 >= 3, reason: `Have ${counts.X4} X4 (>=3)` };
    default:   return { autoPass: false, reason: "" };
  }
}



// ---- Check Ranks for One User ----
async function checkRanksForUHID(uhid) {
  const parent = await getUserByUHID(uhid);
  if (!parent) {
    console.error(`UHID not found: ${uhid}`);
    return;
  }

  // const childRankCounts = await buildChildRankCounts(parent.uhid);
    const { counts: childRankCounts, details: childRankDetails } =
  await buildChildRankCounts(parent.uhid);
  
  






  const parentSelfLP = await getSelfLpByUserId(parent._id);
  
  const teamBreakdown = await getTeamLpBreakdown(parent.uhid);
  
  Object.entries(teamBreakdown).forEach(([lvl, total]) => {
    
  });
  let highest = null;
const legResults = await buildLegRankMap(parent.uhid);
for (const rank of XRANKS) {
  
  const { autoPass, reason, qualifyingLegs } = checkAutoQual(rank.code, legResults, parentSelfLP);

  if (autoPass) {
    
    
    // show legs & users
    qualifyingLegs.forEach((leg, i) => {
      
      leg.users
        .filter(u => normalizeRank(u.xRank || u.xrank) === (
          rank.code === "X2" ? "X1" :
          rank.code === "X3" ? "X2" :
          rank.code === "X4" ? "X3" : "X4"
        ))
        .forEach(u => 
    });
    highest = rank.code;
    continue; // go to next rank
  } else if (reason) {
    
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
    
    
    
    legContributions.forEach((leg, i) => {
      
    });
    highest = rank.code;
  } else {
    
    
    
    legContributions.forEach((leg, i) => {
      
    });
    
    break;
  }
}



  // ---- Update user record ----
  const finalRank = highest || null;
  // await User.updateOne(
  //   { _id: parent._id },
  //   { $set: { xRank: finalRank } }
  // );

  
  
  
}

// ---- Main ----
(async () => {
  if (typeof connectDB === "function") {
    await connectDB();
  } else {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error("MONGODB_URI/MONGO_URI not set");
    await mongoose.connect(uri);
  }

  const uhid = process.argv[2]; // optional arg

  try {
    if (uhid) {
      // Run for one UHID
      
      await checkRanksForUHID(uhid);
    } else {
      // Run for all users with LP > 0
      
      const ledgers = await Ledger.find({ "wallets.lp": { $gt: 0 } }, { userId: 1 }).lean();
      const userIds = ledgers.map((l) => l.userId);

      const users = await User.find({ _id: { $in: userIds } }, { uhid: 1 }).lean();

      

      for (const u of users) {
        try {
          await checkRanksForUHID(u.uhid);
        } catch (err) {
          console.error(`❌ Error checking rank for ${u.uhid}:`, err.message);
        }
      }

      
    }
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await mongoose.disconnect();
  }
})();
