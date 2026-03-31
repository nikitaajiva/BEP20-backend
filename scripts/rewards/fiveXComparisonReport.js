/**
 * FINAL FAST ELIGIBILITY REPORT
 * - Unlimited legs
 * - Correct business rules
 * - Level aware
 * - READ ONLY
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../../config/db");
const User = require("../../models/User");
const Ledger = require("../../models/Ledger");
const Level = require("../../models/Level");
const ExcelJS = require("exceljs");

/* ================= HELPERS ================= */

const toNumber = (v) => {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (v?.$numberDecimal) return Number(v.$numberDecimal);
  return Number(v);
};

/* ================= GLOBAL CACHES ================= */

const childrenMap = new Map();   // parent -> all children
const directLegMap = new Map();  // parent -> direct legs (level = 1)
const lpMap = new Map();         // uhid -> lp
const ledgerMap = new Map();     // uhid -> full ledger

/* ================= PRELOAD ================= */

const preloadLevels = async () => {
  const levels = await Level.find(
    {},
    { parent: 1, child: 1, level: 1 }
  ).lean();

  for (const l of levels) {
    if (!childrenMap.has(l.parent)) childrenMap.set(l.parent, []);
    childrenMap.get(l.parent).push(l.child);

    if (l.level === 1) {
      if (!directLegMap.has(l.parent)) directLegMap.set(l.parent, []);
      directLegMap.get(l.parent).push(l.child);
    }
  }
};

const preloadLedgers = async () => {
  const ledgers = await Ledger.find(
    {},
    { uhid: 1, wallets: 1, limits: 1 }
  ).lean();

  for (const l of ledgers) {
    lpMap.set(l.uhid, toNumber(l.wallets?.lp));
    ledgerMap.set(l.uhid, l);
  }
};

/* ================= CORE LOGIC ================= */

const getFullLegTeam = (legRoot) => {
  const team = new Set();
  const queue = [legRoot];

  while (queue.length) {
    const parent = queue.shift();
    team.add(parent);

    const children = childrenMap.get(parent) || [];
    for (const c of children) {
      if (!team.has(c)) queue.push(c);
    }
  }

  return team;
};

const getLegBusinessMap = (rootUHID) => {
  const directLegs = directLegMap.get(rootUHID) || [];
  const legs = {};

  for (const legRoot of directLegs) {
    const team = getFullLegTeam(legRoot);
    let sum = 0;

    for (const u of team) {
      sum += lpMap.get(u) || 0;
    }

    legs[legRoot] = sum;
  }

  return legs;
};

/**
 * BUSINESS RULES:
 * 2x → no business
 * 3x → actualLp * 1
 * 4x → actualLp * 2
 * 5x → actualLp * 3
 */
const getRequiredBusiness = (actualLp, x) => {
  if (x === 3) return actualLp * 1;
  if (x === 4) return actualLp * 2;
  if (x === 5) return actualLp * 3;
  return 0;
};

const calculateEligibleX = (actualLp, legs) => {
  if (actualLp < 9) return 2;

  const canAchieve = (x) => {
    const required = getRequiredBusiness(actualLp, x);
    if (required === 0) return true;

    const capPerLeg = required * 0.33;
    let usable = 0;

    for (const v of Object.values(legs)) {
      usable += Math.min(v, capPerLeg);
    }

    return usable >= required;
  };

  if (canAchieve(5)) return 5;
  if (canAchieve(4)) return 4;
  if (canAchieve(3)) return 3;
  return 2;
};

/* ================= REPORT ================= */

const generateReport = async ({ uhid = null }) => {
  await connectDB();
  await preloadLevels();
  await preloadLedgers();

  const users = uhid
    ? await User.find({ uhid }).lean()
    : await User.find({}).lean();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("5X Eligibility");

  sheet.columns = [
    { header: "UHID", key: "uhid", width: 18 },
    { header: "Username", key: "username", width: 20 },

    { header: "LP", key: "lp", width: 14 },
    { header: "Autopositioning", key: "auto", width: 18 },
    { header: "Actual LP", key: "actualLp", width: 14 },

    { header: "Direct Legs", key: "legCount", width: 14 },

    { header: "Total Team Business", key: "totalBusiness", width: 20 },
    { header: "Required Business", key: "requiredBusiness", width: 20 },
    { header: "Cap Per Leg (33%)", key: "capPerLeg", width: 22 },
    { header: "Usable Business", key: "usableBusiness", width: 22 },

    { header: "Eligible X", key: "eligibleX", width: 12 },

    { header: "Current LP Limit (5x)", key: "currentLimit", width: 22 },
    { header: "Eligible LP Limit", key: "eligibleLimit", width: 22 },

    { header: "Ledger fiveXLimit", key: "ledgerLimit", width: 18 },
    { header: "Ledger Cap", key: "ledgerCap", width: 14 },
    { header: "Ledger Used", key: "ledgerUsed", width: 14 },
    { header: "Remaining Limit", key: "remaining", width: 18 },

    { header: "Over / Under Used", key: "deltaUsed", width: 18 },
  ];

  let included = 0;

  for (const user of users) {
    const ledger = ledgerMap.get(user.uhid);
    if (!ledger) continue;

    const actualLp =
      toNumber(ledger.wallets?.lp) -
      toNumber(ledger.wallets?.autopositionting);

    if (actualLp < 9) continue;

    const legs = getLegBusinessMap(user.uhid);
    const eligibleX = calculateEligibleX(actualLp, legs);

    const requiredBusiness = getRequiredBusiness(actualLp, eligibleX);
    const capPerLeg = requiredBusiness * 0.33;

    let usableBusiness = 0;
    for (const v of Object.values(legs)) {
      usableBusiness += Math.min(v, capPerLeg);
    }

    const currentLimit = actualLp * 5;
    const eligibleLimit = actualLp * eligibleX;

    const ledgerLimit = toNumber(ledger.limits?.fiveXLimit);
    const ledgerCap = toNumber(ledger.limits?.fiveXLimit?.cap);
    const ledgerUsed = toNumber(ledger.limits?.fiveXLimit?.used);

    sheet.addRow({
      uhid: user.uhid,
      username: user.username,

      lp: toNumber(ledger.wallets?.lp),
      auto: toNumber(ledger.wallets?.autopositionting),
      actualLp,

      legCount: Object.keys(legs).length,

      totalBusiness: Object.values(legs).reduce((a, b) => a + b, 0),
      requiredBusiness,
      capPerLeg,
      usableBusiness,

      eligibleX,

      currentLimit,
      eligibleLimit,

      ledgerLimit,
      ledgerCap,
      ledgerUsed,
      remaining: ledgerLimit - ledgerUsed,

      deltaUsed: ledgerUsed - eligibleLimit,
    });

    included++;
  }

  const fileName = uhid
    ? `fiveX_eligibility_${uhid}.xlsx`
    : `fiveX_eligibility_all.xlsx`;

  const filePath = path.join(__dirname, fileName);
  await workbook.xlsx.writeFile(filePath);

  
  
  

  await mongoose.disconnect();
};

/* ================= CLI ================= */

if (require.main === module) {
  const uhid = process.argv[2] || null;

  generateReport({ uhid })
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { generateReport };
