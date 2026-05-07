const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Decimal128 } = require("mongodb");

// Models
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");
const AirdropReward = require("../../models/AirdropReward");
const BoostReward = require("../../models/BoostReward");
const LpReward = require("../../models/LpReward");
const DailyUserLp = require("../../models/DailyUserLp");
const connectDB = require("../../config/db");
// =============================================================
// ❌ UHIDs THAT SHOULD NEVER RECEIVE BOOST REWARD
// =============================================================
const EXCEPTION_UHIDS = [
  "1754734201443", 
  "1762493388752",
  "1757959930191",
  "1758791903676",
  "1758114607655",
  "1758114585037",
  "17470523327625",
  "17479224136444",
  "17470555591784",
  "17470585986771",
  "17470516223919",
  "1750231172",
  "1750241606",
  "1763464994641",
  "1760943805801",
  "1763651517501",
  "17477217478685",
  "17470520022595",
  "17470511049371",
  "1755236839951",
  "17470115393776",
  "17470301828349",
  "1754724291416",
  "1753116411141",
  "1754244558300",
  "1753179039893",
  "1753172439695",
  "1753196579739",
  "1751039755",
  "1754407144489",
  "1754838594235",
  "1754583207094",
  "1754668601750",
  "17470321597976",
  "17470328215855",
  "17470495204647",
  "1749555592",
  "1749555840",
  "1751036651",
  "1751132636",
  "1752131403635",
  "1753972330223",
  "1754823969799",
  "1754824255985",
  "1754845801859",
  "1754846752754",
  "1754850621024",
  "1754853326240",
  "1756820266794",
  "1758274250925",
  "1759414465429",
  "1759495277557",
  "1760092913539",
  "1760541465586",
  "1760767595069",
  "1760625488279",
  "1757931096796",
  "17471561217489",
  "1760189709881",
  "1760372733602",
  "1760767595069",
  "1760693186803",
  "1757269252798",
  "1761491833495",
  "1760628745253",
  "1763622746467",
  "1755054140887",
  "1763409728731",
  "1761596415391"
];


// Helpers
const toFloat = (d) => parseFloat(d?.toString() || "0");
const fromFloat = (f) => Decimal128.fromString(f.toString());
const fixDecimal = (v) => {
  const n = parseFloat(v?.toString() || "0");
  return isNaN(n) ? 0 : n;
};

// Config
const REWARD_THRESHOLD = 5000;
const REWARD_RATE_HIGH = "0.006"; // 0.6%
const REWARD_RATE_LOW = "0.005";  // 0.5%
const FIVE_X_MULTIPLIER = 5;

async function distributeRewards() {
  await connectDB();
  
  

  // --- Date setup (yesterday UTC) ---
  const today = new Date();
  const utcYest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1, 0, 0, 0));
  

  // --- Load Daily LP Records ---
  const dailyRecords = await DailyUserLp.find({ date: utcYest, lp: { $gt: 0 } });
  

  if (dailyRecords.length === 0) {
    
    await mongoose.disconnect();
    return;
  }

  // --- Build ID lists ---
  const userIds = dailyRecords
    .filter(r => r.userId)
    .map(r => {
      if (mongoose.Types.ObjectId.isValid(r.userId)) {
        return new mongoose.Types.ObjectId(r.userId);
      }
      return r.userId;
    });
  const uhids = dailyRecords.filter(r => r.uhid).map(r => r.uhid.toString().trim());

  // --- Load all ledgers once ---
  const ledgers = await Ledger.find({
    $or: [{ userId: { $in: userIds } }, { uhid: { $in: uhids } }]
  });
  

  // --- Build lookup maps ---
  const ledgerMapByUserId = new Map();
  const ledgerMapByUhid = new Map();
  for (const l of ledgers) {
    if (l.userId) ledgerMapByUserId.set(l.userId.toString(), l);
    if (l.uhid) ledgerMapByUhid.set(l.uhid.toString().trim(), l);
  }

  // --- Prepare skipped log ---
  const logFile = path.join(__dirname, "skipped_users.log");
  fs.writeFileSync(logFile, ""); // clear previous

  // --- Stats ---
  let processed = 0;
  let skipped = 0;
  let totalRewardSum = 0;

  // --- MAIN LOOP ---
  for (const record of dailyRecords) {
    const userIdKey = record.userId ? record.userId.toString() : null;
    const uhidKey = record.uhid ? record.uhid.toString().trim() : null;

    // Hybrid lookup
    let ledger =
      (userIdKey && ledgerMapByUserId.get(userIdKey)) ||
      (uhidKey && ledgerMapByUhid.get(uhidKey));

    // --- Skip if ledger missing ---
    if (!ledger) {
      const msg = `⚠️ [NO LEDGER] username:${record.username || "N/A"} | UHID:${uhidKey || "N/A"} | userId:${userIdKey || "N/A"}\n`;
      console.warn(msg.trim());
      fs.appendFileSync(logFile, msg);
      skipped++;
      continue;
    }

    // --- Defensive normalization (fix NaN/undefined Decimal128s) ---
    ["lpLimit", "airdropLimit", "boostLimit", "fiveXLimit"].forEach(k => {
      if (!ledger.limits[k]) ledger.limits[k] = {};
      ledger.limits[k].cap = fixDecimal(ledger.limits[k].cap);
      ledger.limits[k].used = fixDecimal(ledger.limits[k].used);
    });

    try {
      const lpBalance = record.lp;
      const airdropBalance = toFloat(ledger.wallets.airdrop);
      const boostBalance = toFloat(ledger.wallets.boost);

      // --- 1. Update limit caps ---
      ledger.limits.lpLimit.cap = fromFloat(lpBalance * 2);
      ledger.limits.airdropLimit.cap = fromFloat(airdropBalance);

      // --- 2. Determine rates ---
      const getRate = (bal) => (bal >= REWARD_THRESHOLD ? REWARD_RATE_HIGH : REWARD_RATE_LOW);
      const lpRate = getRate(lpBalance);
      const airdropRate = getRate(airdropBalance);
      const boostRate = getRate(boostBalance);

      // --- 3. Potential rewards ---
      const potentialLp = lpBalance * parseFloat(lpRate);
      const potentialAir = airdropBalance * parseFloat(airdropRate);
      const potentialBoost = boostBalance * parseFloat(boostRate);

      const cap = (r, l) =>
        Math.max(0, Math.min(r, toFloat(l.cap) - toFloat(l.used)));

      let lpReward = cap(potentialLp, ledger.limits.lpLimit);
      let airReward = cap(potentialAir, ledger.limits.airdropLimit);
      let boostReward = cap(potentialBoost, ledger.limits.boostLimit);
         let blockedBoost = false;
    if (uhidKey && EXCEPTION_UHIDS.includes(uhidKey)) {
      blockedBoost = true;
      

      boostReward = 0;
      potentialBoost = 0;
      ledger.limits.boostLimit.used = fromFloat(ledger.limits.boostLimit.used);

      // remove boost from total
    }
      let totalCappedReward = lpReward + airReward + boostReward;

      // ==================================================================


      // --- 4. Apply global 5× LP cap ---
      const fiveXUsed = fixDecimal(ledger.limits.fiveXLimit.used);
      const maxFiveX = Math.max(0, lpBalance * FIVE_X_MULTIPLIER - fiveXUsed);
      // const finalReward = Math.min(totalCappedReward, maxFiveX);

      let finalReward = blockedBoost
  ? (lpReward + airReward)
  : Math.min(totalCappedReward, maxFiveX);


      if (finalReward <= 0) {
        const msg = `⚠️ [ZERO REWARD] username:${ledger.username || record.username || "N/A"} | UHID:${ledger.uhid || record.uhid} | LP=${record.lp} | totalReward=0\n`;
        fs.appendFileSync(logFile, msg);
        skipped++;
        continue;
      }

      // if (finalReward < totalCappedReward && totalCappedReward > 0) {
      //   const factor = finalReward / totalCappedReward;
      //   lpReward *= factor;
      //   airReward *= factor;
      //   boostReward *= factor;
      // }


      // --- 5. Update ledger balances ---
      ledger.wallets.communityRewards = fromFloat(
        toFloat(ledger.wallets.communityRewards) + finalReward
      );
      ledger.totalRewardsCredited = fromFloat(
        toFloat(ledger.totalRewardsCredited) + finalReward
      );
      ledger.limits.lpLimit.used = fromFloat(toFloat(ledger.limits.lpLimit.used) + lpReward);
      ledger.limits.airdropLimit.used = fromFloat(toFloat(ledger.limits.airdropLimit.used) + airReward);
      // ledger.limits.boostLimit.used = fromFloat(toFloat(ledger.limits.boostLimit.used) + boostReward);
      if (!blockedBoost) {
    ledger.limits.boostLimit.used = fromFloat(toFloat(ledger.limits.boostLimit.used) + boostReward);
}

      ledger.limits.fiveXLimit.used = fromFloat(fiveXUsed + finalReward);

      await ledger.save();
      processed++;
      totalRewardSum += finalReward;

      // --- 6. Ledger rows ---
      const rows = [];
      const utcNow = new Date().toUTCString();

    // LP Reward
  if (lpReward && lpReward > 0) {
    const narrative = `Balance: ${lpBalance.toFixed(4)}, Reward: ${lpReward.toFixed(4)} @ ${(parseFloat(lpRate) * 100).toFixed(2)}% on ${utcNow}`;
    
    await LpReward.create({
      userId: ledger.userId,
      amount: fromFloat(lpReward),
      rate: fromFloat(lpRate),
      narrative,
    });

    rows.push({
      userId: ledger.userId,
      eventType: "DAILY_REWARDS_LP",
      walletTo: "COMMUNITY_REWARDS",
      amount: fromFloat(lpReward),
      narrative,
    });
  }

  // Airdrop Reward
  if (airReward && airReward > 0) {
    const narrative = `Balance: ${airdropBalance.toFixed(4)}, Reward: ${airReward.toFixed(4)} @ ${(parseFloat(airdropRate) * 100).toFixed(2)}% on ${utcNow}`;

    await AirdropReward.create({
      userId: ledger.userId,
      amount: fromFloat(airReward),
      rate: fromFloat(airdropRate),
      narrative,
    });

    rows.push({
      userId: ledger.userId,
      eventType: "DAILY_REWARDS_AIRDROP",
      walletTo: "COMMUNITY_REWARDS",
      amount: fromFloat(airReward),
      narrative,
    });
  }

  // Boost Reward
  // if (boostReward && boostReward > 0) {
  //   const narrative = `Balance: ${boostBalance.toFixed(4)}, Reward: ${boostReward.toFixed(4)} @ ${(parseFloat(boostRate) * 100).toFixed(2)}% on ${utcNow}`;

  //   await BoostReward.create({
  //     userId: ledger.userId,
  //     amount: fromFloat(boostReward),
  //     rate: fromFloat(boostRate),
  //     narrative,
  //   });

  //   rows.push({
  //     userId: ledger.userId,
  //     eventType: "DAILY_REWARDS_BOOST",
  //     walletTo: "COMMUNITY_REWARDS",
  //     amount: fromFloat(boostReward),
  //     narrative,
  //   });
  // }

  // Boost Reward (skip if UHID is blocked)
if (boostReward > 0 && !(uhidKey && EXCEPTION_UHIDS.includes(uhidKey))) {

    const narrative = `Balance: ${boostBalance.toFixed(4)}, Reward: ${boostReward.toFixed(4)} @ ${(parseFloat(boostRate) * 100).toFixed(2)}% on ${utcNow}`;

    await BoostReward.create({
      userId: ledger.userId,
      amount: fromFloat(boostReward),
      rate: fromFloat(boostRate),
      narrative,
    });

    rows.push({
      userId: ledger.userId,
      eventType: "DAILY_REWARDS_BOOST",
      walletTo: "COMMUNITY_REWARDS",
      amount: fromFloat(boostReward),
      narrative,
    });
}


  // --- Ledger Rows Insert ---
      if (rows.length > 0) {
        await LedgerRow.insertMany(rows);
        
      } else {
        console.warn(`⚠️ No rewards generated for user ${ledger.userId}`);
      }
     

    } catch (err) {
      console.error(`❌ Error processing ${record.username || record.userId}:`, err.message);
      fs.appendFileSync(logFile, `Error for ${record.username || record.userId}: ${err.message}\n`);
    }
  }

  
  
  
  
  
  

  await mongoose.disconnect();
  
}

distributeRewards();
