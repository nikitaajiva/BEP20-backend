require("dotenv").config();

const mongoose = require("mongoose");
const Outbox = require("../models/Outbox");
const LedgerRow = require("../models/LedgerRow");
const { getSystemReport } = require("../controllers/supportController");

function parseArgs(argv) {
  const options = {
    date: null,
    limit: 5,
    json: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--date=")) {
      options.date = arg.slice("--date=".length);
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    } else if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

function getUtcRange(dateInput) {
  const base = dateInput ? new Date(`${dateInput}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid --date value: ${dateInput}. Use YYYY-MM-DD.`);
  }

  const start = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 59, 59, 999)
  );

  return {
    dateKey: start.toISOString().slice(0, 10),
    start,
    end,
  };
}

function toNumber(value) {
  if (value == null) return 0;
  const parsed = Number.parseFloat(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function runSystemReport() {
  return new Promise((resolve, reject) => {
    const req = { query: { refresh: "1" } };
    const res = {
      headers: {},
      statusCode: 200,
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400 || payload?.success === false) {
          reject(new Error(payload?.message || "System report failed"));
          return;
        }
        resolve(payload?.data || payload?.report || payload);
      },
    };

    Promise.resolve(getSystemReport(req, res)).catch(reject);
  });
}

async function collectCronSummary({ dateKey, start, end, limit }) {
  const [batchEvents, userStatusCounts, creditAgg, cascadeAgg, recentRows] =
    await Promise.all([
      Outbox.find(
        {
          eventType: "DAILY_ROI_BATCH",
          "payload.processingDate": dateKey,
        },
        {
          eventType: 1,
          status: 1,
          tryCount: 1,
          nextRunTs: 1,
          createdAt: 1,
          lastAttemptTs: 1,
          payload: 1,
          errorDetails: { $slice: -1 },
        }
      ).sort({ createdAt: -1 }),
      Outbox.aggregate([
        {
          $match: {
            eventType: "DAILY_ROI_USER",
            "payload.processingDate": dateKey,
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      LedgerRow.aggregate([
        {
          $match: {
            eventType: "ROI_CREDIT",
            ts: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            rowCount: { $sum: 1 },
            users: { $addToSet: "$userId" },
          },
        },
      ]),
      LedgerRow.aggregate([
        {
          $match: {
            eventType: "ROI_CASCADE",
            ts: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            rowCount: { $sum: 1 },
            users: { $addToSet: "$userId" },
          },
        },
      ]),
      LedgerRow.find(
        {
          eventType: { $in: ["ROI_CREDIT", "ROI_CASCADE"] },
          ts: { $gte: start, $lte: end },
        },
        {
          userId: 1,
          eventType: 1,
          amount: 1,
          walletFrom: 1,
          walletTo: 1,
          narrative: 1,
          ts: 1,
        }
      )
        .sort({ ts: -1 })
        .limit(limit)
        .lean(),
    ]);

  const creditSummary = creditAgg[0] || {
    totalAmount: 0,
    rowCount: 0,
    users: [],
  };
  const cascadeSummary = cascadeAgg[0] || {
    totalAmount: 0,
    rowCount: 0,
    users: [],
  };

  return {
    batchEvents,
    userStatusCounts,
    roiCredit: {
      totalAmount: toNumber(creditSummary.totalAmount),
      rowCount: creditSummary.rowCount || 0,
      userCount: creditSummary.users?.length || 0,
    },
    roiCascade: {
      totalAmount: toNumber(cascadeSummary.totalAmount),
      rowCount: cascadeSummary.rowCount || 0,
      userCount: cascadeSummary.users?.length || 0,
    },
    recentRows: recentRows.map((row) => ({
      ts: row.ts,
      eventType: row.eventType,
      userId: row.userId?.toString?.() || String(row.userId),
      amount: toNumber(row.amount),
      walletFrom: row.walletFrom,
      walletTo: row.walletTo,
      narrative: row.narrative,
    })),
  };
}

function buildFrontendSummary(report) {
  const trend = report?.trend7d || {};
  return {
    totalDeposits: toNumber(report?.totalPositiveLP),
    totalWithdrawals: toNumber(report?.totalNegativeLP),
    totalRewards:
      toNumber(report?.distributedLpRewards) +
      toNumber(report?.distributedAirdropRewards) +
      toNumber(report?.distributedBoosterRewards) +
      toNumber(report?.totalX1Rewards) +
      toNumber(report?.totalCommunityBoosterRewards) +
      toNumber(report?.totalCascadeRewards),
    ecosystemFee: toNumber(report?.totalEcosystemFee),
    activeLPUsers: toNumber(report?.activeLPUsers),
    newUsersToday: toNumber(report?.newUsersToday),
    todayDepositsAmount: toNumber(report?.onChainDepositsToday?.total),
    todayDepositsCount: toNumber(report?.onChainDepositsToday?.txCount),
    todayWithdrawalsAmount: toNumber(report?.onChainWithdrawalsToday?.total),
    todayWithdrawalsCount: toNumber(report?.onChainWithdrawalsToday?.txCount),
    dailyRewardsTotal: toNumber(report?.dailyRewards?.total),
    trend7d: {
      labels: Array.isArray(trend.labels) ? trend.labels : [],
      deposits: Array.isArray(trend.deposits) ? trend.deposits.map(toNumber) : [],
      withdrawals: Array.isArray(trend.withdrawals) ? trend.withdrawals.map(toNumber) : [],
      newUsers: Array.isArray(trend.newUsers) ? trend.newUsers.map(toNumber) : [],
    },
  };
}

function printTextReport({ dateKey, cronSummary, frontendSummary }) {
  console.log(`ROI Cron Check for UTC date ${dateKey}`);
  console.log("");

  console.log("Outbox Batch");
  if (cronSummary.batchEvents.length === 0) {
    console.log("  No DAILY_ROI_BATCH event found for this date.");
  } else {
    for (const batch of cronSummary.batchEvents) {
      const lastError = batch.errorDetails?.[0]?.message || "";
      console.log(
        `  ${batch.status} | created ${batch.createdAt?.toISOString?.() || batch.createdAt} | tries ${batch.tryCount}${
          lastError ? ` | last error: ${lastError}` : ""
        }`
      );
    }
  }

  console.log("");
  console.log("User Event Status");
  if (cronSummary.userStatusCounts.length === 0) {
    console.log("  No DAILY_ROI_USER events found for this date.");
  } else {
    for (const item of cronSummary.userStatusCounts) {
      console.log(`  ${item._id}: ${item.count}`);
    }
  }

  console.log("");
  console.log("Ledger Impact");
  console.log(
    `  ROI_CREDIT: ${cronSummary.roiCredit.rowCount} rows | ${cronSummary.roiCredit.userCount} users | total ${cronSummary.roiCredit.totalAmount}`
  );
  console.log(
    `  ROI_CASCADE: ${cronSummary.roiCascade.rowCount} rows | ${cronSummary.roiCascade.userCount} users | total ${cronSummary.roiCascade.totalAmount}`
  );

  console.log("");
  console.log("Frontend System Report Snapshot");
  console.log(`  totalDeposits: ${frontendSummary.totalDeposits}`);
  console.log(`  totalWithdrawals: ${frontendSummary.totalWithdrawals}`);
  console.log(`  totalRewards: ${frontendSummary.totalRewards}`);
  console.log(`  ecosystemFee: ${frontendSummary.ecosystemFee}`);
  console.log(`  activeLPUsers: ${frontendSummary.activeLPUsers}`);
  console.log(`  newUsersToday: ${frontendSummary.newUsersToday}`);
  console.log(
    `  todayDeposits: ${frontendSummary.todayDepositsAmount} across ${frontendSummary.todayDepositsCount} tx`
  );
  console.log(
    `  todayWithdrawals: ${frontendSummary.todayWithdrawalsAmount} across ${frontendSummary.todayWithdrawalsCount} tx`
  );
  console.log(`  dailyRewardsTotal: ${frontendSummary.dailyRewardsTotal}`);
  console.log(
    `  trend7d labels: ${frontendSummary.trend7d.labels.join(", ") || "none"}`
  );

  console.log("");
  console.log("Recent ROI Ledger Rows");
  if (cronSummary.recentRows.length === 0) {
    console.log("  No ROI_CREDIT / ROI_CASCADE rows found for this date.");
  } else {
    for (const row of cronSummary.recentRows) {
      console.log(
        `  ${row.ts?.toISOString?.() || row.ts} | ${row.eventType} | user ${row.userId} | amount ${row.amount}`
      );
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { dateKey, start, end } = getUtcRange(options.date);

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing in BEP20-backend/.env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    const [cronSummary, report] = await Promise.all([
      collectCronSummary({ dateKey, start, end, limit: options.limit }),
      runSystemReport(),
    ]);

    const frontendSummary = buildFrontendSummary(report);
    const result = {
      checkedUtcDate: dateKey,
      cronSummary,
      frontendSummary,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    printTextReport({ dateKey, cronSummary, frontendSummary });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("checkRoiCron failed:", error.message);
  process.exit(1);
});
