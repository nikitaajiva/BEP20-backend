// scripts/rewards/distributeX1.js
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const moment = require("moment");
const connectDB = require("../../config/db");
const LedgerRow = require("../../models/LedgerRow");
const User = require("../../models/User");
const Level = require("../../models/Level");
const DailyUserLp = require("../../models/DailyUserLp");
const { handleX1WithStoredRanks, X_TIERS } = require("../../jobs/eventHandlers/x1Handler");

/**
 * Simple concurrency pool (avoids ESM deps like p-map)
 */
async function processWithConcurrency(items, worker, concurrency = 20) {
  const results = [];
  let i = 0;

  async function workerLoop() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx]);
      } catch (err) {
        results[idx] = { error: err };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, workerLoop));
  return results;
}

/**
 * Get qualified upline users with ranks + daily LP
 */
async function getQualifiedUplineChain(startingUhid, eventDate) {
  const uplineChain = [];
  let currentUhid = startingUhid;
  let processedLevels = 0;
  const LEVELS_PER_BATCH = 16;

  // Precompute event day range
  const startOfDay = new Date(eventDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  while (currentUhid && processedLevels < LEVELS_PER_BATCH) {
    const level = await Level.findOne({ child: currentUhid }).lean();
    if (!level?.parent) break;

    const uplineUser = await User.findOne({
      uhid: level.parent,
      xRank: { $ne: null },
    }).lean();

    if (uplineUser) {
      const dailyLp = await DailyUserLp.findOne({
        uhid: uplineUser.uhid,
        date: { $gte: startOfDay, $lte: endOfDay },
      }).lean();

      if (dailyLp) {
        uplineChain.push({
          user: uplineUser,
          qualification: {
            tier: uplineUser.xRank,
            rate: X_TIERS[uplineUser.xRank]?.rate || 0,
          },
          level: processedLevels + 1,
          selfLp: dailyLp.selfLp,
          teamLp: dailyLp.teamLp,
        });
      }
    }

    currentUhid = level.parent;
    processedLevels++;
  }

  return uplineChain;
}

const distributeX1 = async (options = {}) => {
  const isDryRun = options.dryRun || false;
  const fromDate = options.fromDate
    ? moment(options.fromDate).startOf("day").toDate()
    : null;
  const toDate = options.toDate
    ? moment(options.toDate).endOf("day").toDate()
    : null;
  const concurrency = options.concurrency || 20;

  console.log(`Running in ${isDryRun ? "DRY RUN" : "LIVE"} mode`);
  if (fromDate) console.log(`From date: ${fromDate.toISOString()}`);
  if (toDate) console.log(`To date: ${toDate.toISOString()}`);
  console.log(`Concurrency: ${concurrency}`);

  try {
    await connectDB();
    console.log("🚀 Starting X1–X5 reward distribution...");

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);

    const query = {
      eventType: "DAILY_REWARDS_LP",
      ts: { $gte: yesterday, $lt: today },
      $or: [{ x1Processed: { $exists: false } }, { x1Processed: false }],
    };

    if (fromDate || toDate) {
      query.ts = {};
      if (fromDate) query.ts.$gte = fromDate;
      if (toDate) query.ts.$lte = toDate;
    }

    const lpDepositEvents = await LedgerRow.find(query)
      .sort({ ts: 1 })
      .lean();

    console.log(
      `📦 Found ${lpDepositEvents.length} unprocessed events to analyze.`
    );
    if (lpDepositEvents.length > 0) {
      console.log(
        "Sample event:",
        JSON.stringify(lpDepositEvents[0], null, 2)
      );
    }

    let processedCount = 0;
    let errorCount = 0;
    let qualifiedCount = 0;
    let totalRewardsAmount = 0;

    const updates = await processWithConcurrency(
      lpDepositEvents,
      async (event) => {
        try {
          const depositor = await User.findById(event.userId).lean();
          if (!depositor) {
            console.log(`⚠️ Depositor ${event.userId} not found`);
            return null;
          }

          const qualifiedUplines = await getQualifiedUplineChain(
            depositor.uhid,
            event.ts
          );

          if (qualifiedUplines.length > 0) {
            if (!isDryRun) {
              await handleX1WithStoredRanks({
                depositor,
                qualifiedUplines,
                depositAmount: event.amount.toString(),
                triggeringEventId: event._id.toString(),
              });
            }
            qualifiedCount++;
            totalRewardsAmount += Number(event.amount);
          } else {
            console.log(`No qualified uplines for ${depositor.username}`);
          }

          processedCount++;
          return {
            updateOne: {
              filter: { _id: event._id },
              update: { $set: { x1Processed: true } },
            },
          };
        } catch (err) {
          errorCount++;
          console.error(`❌ Failed event ${event._id}:`, err);
          return null;
        }
      },
      concurrency
    );

    // Bulk mark processed
    if (!isDryRun) {
      const ops = updates.filter(Boolean);
      if (ops.length > 0) {
        const result = await LedgerRow.bulkWrite(ops, { ordered: false });
        console.log(`✅ Marked ${result.modifiedCount} events as processed`);
      }
    }

    const summary = {
      totalEvents: lpDepositEvents.length,
      processedCount,
      errorCount,
      qualifiedCount,
      totalRewardsAmount,
    };

    console.log("\n📋 Processing Summary:");
    console.log(JSON.stringify(summary, null, 2));
    console.log(
      `\n✅ X1–X5 distribution finished in ${
        isDryRun ? "DRY RUN" : "LIVE"
      } mode.`
    );

    await mongoose.disconnect();
    return summary;
  } catch (error) {
    console.error("❌ Script failed:", error);
    await mongoose.disconnect();
    throw error;
  }
};

// CLI args
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    fromDate: null,
    toDate: null,
    concurrency: 20,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--from-date":
        options.fromDate = args[++i];
        break;
      case "--to-date":
        options.toDate = args[++i];
        break;
      case "--concurrency":
        options.concurrency = parseInt(args[++i], 10);
        break;
    }
  }
  return options;
};

// If main
if (require.main === module) {
  const options = parseArgs();
  distributeX1(options)
    .then(() => {
      console.log("✅ Script completed successfully");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Script failed:", err);
      process.exit(1);
    });
}

module.exports = { distributeX1 };
