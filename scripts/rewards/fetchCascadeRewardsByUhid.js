// scripts/reports/fetchCascadeRewardsByUhid.js
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

// Models
const User = require("../../models/User");
const CascadeReward = require("../../models/CascadeReward");
const connectDB = require("../../config/db");
const {
  cascadeUnlockRules,
  handleDifferentialRoiCascade,
  checkSponsorUnlockAtLevel,
} = require("../../jobs/eventHandlers/differentialRoiCascadeHandler");



function parseNarrative(narrative) {
  // Example: "Differential Cascade (L2 @ 10%) from pradeep2016nair."
  const match = narrative.match(/\(L(\d+) @ ([\d.]+)%\) from ([^.]+)\.?/);
  if (match) {
    return {
      level: parseInt(match[1], 10),
      percent: parseFloat(match[2]),
      fromUser: match[3],
    };
  }
  return { level: null, percent: null, fromUser: null };
}

async function run(uhid) {
  try {
    await connectDB();

    // Step 1: Find userId by uhid
    const user = await User.findOne({ uhid });
    if (!user) {
      console.error(`❌ User with uhid ${uhid} not found`);
      return;
    }
    const userId = user._id;

     /******************* USER UNLOCKS **************************/
      if (uhid) {    
        let maxUnlockedLevel = 0;
        console.log(
          `\n🔎 Checking unlock status for UHID ${uhid} (${user.username})\n`
        );
    
        for (const rule of cascadeUnlockRules) {
          const q = await checkSponsorUnlockAtLevel(user, rule);
          if (q.qualified) {
            maxUnlockedLevel = rule.level;
            console.log(
              `✅ Level ${rule.level} unlocked | selfLP >= ${
                rule.selfLpOrTeamLp3?.selfLp ||
                rule.selfLpOrTeamLp5?.selfLp ||
                9
              } | minDirects = ${rule.minDirects}`
            );
          } else {
            console.log(
              `❌ Level ${rule.level} locked | minDirects=${rule.minDirects}, LP conditions=${JSON.stringify(
                rule.selfLpOrTeamLp3 || rule.selfLpOrTeamLp5
              )} | Reason: ${q.reason}`
            );
            break;
          }
        }
    
        console.log(
          `\n🔐 UHID ${uhid} (${user.username}) unlocks up to Level ${maxUnlockedLevel}\n`
        );
      }
      /******************** USER UNLOCKS ENDS HERE ***************/

    // Step 2: Get yesterday’s UTC range
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));

    console.log(`📅 Fetching CascadeRewards for UHID ${uhid}, userId ${userId}, between ${start} and ${end}`);

    // Step 3: Fetch rewards
    const rewards = await CascadeReward.find({
      userId,
      createdAt: { $gte: start, $lte: end },
    }).lean();

    if (rewards.length === 0) {
      console.log("⚠️ No CascadeRewards found for yesterday.");
      return;
    }

    // Group by level
    const grouped = {};
    let grandTotal = 0;

    rewards.forEach(r => {
      const { level, percent, fromUser } = parseNarrative(r.narrative);
      const amt = parseFloat(r.amount.$numberDecimal || r.amount);
      grandTotal += amt;

      if (!grouped[level]) grouped[level] = { entries: [], total: 0 };
      grouped[level].entries.push({ percent, fromUser, amt });
      grouped[level].total += amt;
    });

    console.log("\n========= Cascade Rewards Breakdown =========\n");

    Object.keys(grouped)
      .sort((a, b) => Number(a) - Number(b)) // order by level ascending
      .forEach(level => {
        console.log(`Level ${level}`);
        grouped[level].entries.forEach(e => {
          console.log(`  @ ${e.percent}% from ${e.fromUser} → ${e.amt.toFixed(6)}`);
        });
        console.log(`  Total (L${level}): ${grouped[level].total.toFixed(6)}\n`);
      });

    console.log("---------------------------------------------");
    console.log(`GRAND TOTAL: ${grandTotal.toFixed(6)}\n`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB Disconnected");
  }
}

// CLI Input
const uhid = process.argv[2];
if (!uhid) {
  console.error("Usage: node scripts/reports/fetchCascadeRewardsByUhid.js <UHID>");
  process.exit(1);
}

run(uhid);
