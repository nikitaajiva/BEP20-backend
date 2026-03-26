/**
 * Script: storeTeamLPSnapshot.js
 * Purpose:
 *  - Store team LP snapshot for users having xRank
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../../config/db");

const User = require("../../models/User");
const Level = require("../../models/Level");
const Ledger = require("../../models/Ledger");
const XRankTeamLPSnapshot = require("../../models/XRankTeamLPSnapshot");

/* =========================
   HELPERS
========================= */
function toNumber(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  return Number(val.toString());
}

/* =========================
   TEAM LP CALCULATION
========================= */
async function getTeamLPByUhid(parentUhid) {
  // 1️⃣ Get all team members from Level table
  const teamLevels = await Level.find({
    parent: parentUhid
  }).select("child").lean();

  if (!teamLevels.length) return 0;

  const childUhids = teamLevels.map(l => String(l.child));

  // 2️⃣ Fetch ledgers for all team members
  const ledgers = await Ledger.find({
    uhid: { $in: childUhids }
  }).select("wallets.lp").lean();

  // 3️⃣ Sum LP
  return ledgers.reduce(
    (sum, l) => sum + toNumber(l.wallets?.lp),
    0
  );
}

/* =========================
   MAIN
========================= */
async function run() {
  await connectDB();

  const users = await User.find({
    xRank: { $ne: null }
  }).select("_id uhid xRank").lean();

  console.log(`📌 Found ${users.length} users with xRank`);

  for (const user of users) {
    const teamLP = await getTeamLPByUhid(String(user.uhid));

    await XRankTeamLPSnapshot.create({
      userId: user._id,
      uhid: String(user.uhid),
      xRank: user.xRank,
      teamLP: mongoose.Types.Decimal128.fromString(teamLP.toString()),
      snapshotDate: new Date(),
    });

    console.log(
      `✅ Snapshot stored | UHID: ${user.uhid} | Team LP: ${teamLP}`
    );
  }

  console.log("🎯 Team LP snapshot completed");
  process.exit(0);
}

/* =========================
   EXEC
========================= */
run().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
