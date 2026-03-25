const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const BoostReward = require("../../models/BoostReward");
const { Decimal128 } = require("mongodb");
const connectDB = require("../../config/db");
// Helpers
const toFloat = (v) => parseFloat(v?.toString() || "0");
const fromFloat = (v) => Decimal128.fromString(v.toString());
const fixDecimal = (v) => {
  const n = parseFloat(v?.toString() || "0");
  return isNaN(n) ? 0 : n;
};

// CLI flags
const DRY_RUN = process.argv.includes("--dry");
console.log(`\n🚀 Mode: ${DRY_RUN ? "DRY RUN (no DB changes)" : "LIVE RUN (changes applied)"}`);

// Rates
const REWARD_THRESHOLD = 5000;
const RATE_HIGH = 0.006;
const RATE_LOW = 0.005;

// UHIDs
const USERS_UHIDS = [
  // (your list unchanged)
  "1754734201443","1762493388752","1757959930191","1758791903676","1758114607655",
  "1758114585037","17470523327625","17479224136444","17470555591784","17470585986771",
  "17470516223919","1750231172","1750241606","1763464994641","1760943805801",
  "1763651517501","17477217478685","17470520022595","17470511049371","1755236839951",
  "17470115393776","17470301828349","1754724291416","1753116411141","1754244558300",
  "1753179039893","1753172439695","1753196579739","1751039755","1754407144489",
  "1754838594235","1754583207094","1754668601750","17470321597976","17470328215855",
  "17470495204647","1749555592","1749555840","1751036651","1751132636","1752131403635",
  "1753972330223","1754823969799","1754824255985","1754845801859","1754846752754",
  "1754850621024","1754853326240","1756820266794","1758274250925","1759414465429",
  "1759495277557","1760092913539","1760541465586","1760767595069","1760625488279",
  "1757931096796","17471561217489","1760189709881","1760372733602","1760767595069",
  "1760693186803","1757269252798","1761491833495","1760628745253","1763622746467",
  "1755054140887","1763409728731","1761596415391"
];

async function run() {
  await connectDB();
  console.log("⚡ Connected to MongoDB");

  const today = new Date();
  const utcYest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

  const startYest = new Date(utcYest.setHours(0, 0, 0, 0));
  const endYest   = new Date(utcYest.setHours(23, 59, 59, 999));

  const summary = [];

  for (const uhid of USERS_UHIDS) {
    console.log("\n---------------------------------------------");
    console.log(`🔍 Checking UHID: ${uhid}`);

    const ledger = await Ledger.findOne({ uhid: uhid.trim() });
    if (!ledger) {
      console.log("❌ Ledger NOT FOUND");
      summary.push({ uhid, status: "NO_LEDGER" });
      continue;
    }

    // ====================================
    // Sync Caps
    // ====================================
    if (!DRY_RUN) {
      ledger.limits.fiveXLimit.cap = ledger.limits.boostLimit.cap;
      await ledger.save();
    } else {
      console.log(`(dry-run) Sync caps → fiveXLimit.cap = ${ledger.limits.boostLimit.cap}`);
    }

    // ====================================
    // Calculate correct reward
    // ====================================
    const boostBalance = toFloat(ledger.wallets.boost);
    const rate = boostBalance >= REWARD_THRESHOLD ? RATE_HIGH : RATE_LOW;

    const potentialReward = boostBalance * rate;

    const cap = fixDecimal(ledger.limits.fiveXLimit.cap);
    const used = fixDecimal(ledger.limits.fiveXLimit.used);

    let available = cap - used;
    if (available < 0) available = 0;

    let correctReward = Math.min(potentialReward, available);

    if (correctReward <= 0) {
      summary.push({ uhid, status: "NO_REWARD_CAP_REACHED" });
      continue;
    }

    // ====================================
    // Fetch Yesterday Rows
    // ====================================
    const rows = await LedgerRow.find({
      userId: ledger.userId,
      eventType: "DAILY_REWARDS_BOOST",
      ts: { $gte: startYest, $lte: endYest }
    });

    const existingAmount = rows.reduce((sum, r) => sum + toFloat(r.amount), 0);

    // ====================================
    // Decide Action
    // ====================================
    if (existingAmount === 0) {
      console.log("⚠️ No reward yet → FULL CREDIT needed");

      summary.push({
        uhid,
        userId: ledger.userId.toString(),
        given: 0,
        correct: correctReward,
        needToAdd: correctReward,
        action: DRY_RUN ? "DRY-FULL" : "FULL"
      });

      if (!DRY_RUN) await creditAmount(ledger, correctReward, boostBalance, rate, startYest);

      continue;
    }

    if (existingAmount === correctReward) {
      console.log("✅ Reward correct → No changes needed");

      summary.push({
        uhid,
        userId: ledger.userId.toString(),
        given: existingAmount,
        correct: correctReward,
        needToAdd: 0,
        action: "NONE"
      });

      continue;
    }

    if (existingAmount < correctReward) {
      const diff = correctReward - existingAmount;
      console.log(`🔧 Underpaid → Need top-up: ${diff}`);

      summary.push({
        uhid,
        userId: ledger.userId.toString(),
        given: existingAmount,
        correct: correctReward,
        needToAdd: diff,
        action: DRY_RUN ? "DRY-TOPUP" : "TOPUP"
      });

      if (!DRY_RUN) {
        await creditAmount(ledger, diff, boostBalance, rate, startYest);

        // Update last row
        const lastRow = rows[rows.length - 1];
        lastRow.amount = fromFloat(correctReward);
        lastRow.narrative = `Balance: ${boostBalance.toFixed(4)}, Reward Corrected: ${correctReward.toFixed(4)} @ ${(rate * 100).toFixed(2)}%`;
        lastRow.updatedAt = startYest;
        await lastRow.save();
      }

      continue;
    }

    // Overpaid Case
    summary.push({
      uhid,
      userId: ledger.userId.toString(),
      given: existingAmount,
      correct: correctReward,
      needToAdd: 0,
      action: "OVERPAID"
    });

    console.log("⚠️ Overpaid → No fix applied");
  }

  // ====================================
  // REPORT OUTPUT
  // ====================================
  console.log("\n================ DRY RUN REPORT ================");
  console.table(summary);

  const reportFile = DRY_RUN
    ? "dryrun_boost_report.json"
    : "boost_recovery_report.json";

  fs.writeFileSync(reportFile, JSON.stringify(summary, null, 2));
  console.log(`📄 Report saved: ${reportFile}`);

  await mongoose.disconnect();
  console.log("🔌 Disconnected");
}

// ==========================================================
// Helper to apply updates (live mode only)
// ==========================================================
async function creditAmount(ledger, amount, boostBalance, rate, ts) {
  const narrative = `Balance: ${boostBalance.toFixed(4)}, Reward: ${amount.toFixed(4)} @ ${(rate * 100).toFixed(2)}%`;

  ledger.wallets.communityRewards = fromFloat(toFloat(ledger.wallets.communityRewards) + amount);
  ledger.totalRewardsCredited = fromFloat(toFloat(ledger.totalRewardsCredited) + amount);

  ledger.limits.fiveXLimit.used = fromFloat(
    fixDecimal(ledger.limits.fiveXLimit.used) + amount
  );

  ledger.limits.boostLimit.used = fromFloat(
    fixDecimal(ledger.limits.boostLimit.used) + amount
  );

  await ledger.save();

  await BoostReward.create({
    userId: ledger.userId,
    amount: fromFloat(amount),
    rate: fromFloat(rate),
    narrative
  });

  await LedgerRow.create({
    userId: ledger.userId,
    eventType: "DAILY_REWARDS_BOOST",
    walletTo: "COMMUNITY_REWARDS",
    amount: fromFloat(amount),
    narrative,
    ts,
    updatedAt: ts
  });
}

run();
