// scripts/cloneX1FromDate4.js
//----------------------------------------------------
/**
 * Test Mode:
 * Clone X1 rewards from 4th Dec for a single test user
 * Insert clones with today's date
 * Update:
 *   - wallets.xBonus
 *   - wallets.communityRewards
 *   - limits.fiveXLimit.used
 */
//----------------------------------------------------

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
const X1Rewards = require("../models/X1Reward");
const Ledger = require("../models/Ledger");

const { Decimal128 } = mongoose.Types;

// --------------------------------------------------
// TEST USER ID (as requested)
const TARGET_USER = new mongoose.Types.ObjectId("68416df05d8deee438fae10a");

// Clone data FROM this date (4th)
const CLONE_SOURCE_DATE = "2025-12-01";

// Insert cloned rewards using this timestamp
const CLONE_TS = new Date();
// --------------------------------------------------

async function run() {
  
  await connectDB();

  

  const start = new Date(`${CLONE_SOURCE_DATE}T00:00:00.000Z`);
  const end = new Date(`${CLONE_SOURCE_DATE}T23:59:59.999Z`);

  const records = await X1Rewards.find({
    userId: TARGET_USER,
    ts: { $gte: start, $lte: end },
  });

  if (!records.length) {
    
    process.exit(0);
  }

  

  let insertPayload = [];
  let totalAmount = 0;

  for (const r of records) {
    const amt = parseFloat(r.amount.toString());
    totalAmount += amt;

    insertPayload.push({
      userId: r.userId,
      depositorId: r.depositorId,
      amount: r.amount,
      tier: r.tier,
      rate: r.rate,
      level: r.level,
      depositAmount: r.depositAmount,
      triggeringEventId: r.triggeringEventId,
      ts: CLONE_TS,
    });
  }

  await X1Rewards.insertMany(insertPayload);

  
  

  // --------------------------------------------------
  // UPDATE LEDGER WALLETS + fiveXLimit.used
  // --------------------------------------------------
  

  const ledger = await Ledger.findOne({ userId: TARGET_USER });
  if (!ledger) {
    
    process.exit(1);
  }

  const xBonusOld = parseFloat(ledger.wallets.xBonus.toString());
  const crOld = parseFloat(ledger.wallets.communityRewards.toString());
  const fiveXUsedOld = parseFloat(ledger.limits.fiveXLimit.used.toString());

  ledger.wallets.xBonus = Decimal128.fromString(
    (xBonusOld + totalAmount).toString()
  );

  ledger.wallets.communityRewards = Decimal128.fromString(
    (crOld + totalAmount).toString()
  );

  ledger.limits.fiveXLimit.used = Decimal128.fromString(
    (fiveXUsedOld + totalAmount).toString()
  );

  await ledger.save();

  
  
  
  

  
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});
