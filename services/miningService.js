const mongoose = require("mongoose");
const UserNft = require("../models/UserNft");
const MiningSnapshot = require("../models/MiningSnapshot");
const { creditTscAvailable } = require("./internalTokenLedgerService");

const toNumber = (value) => Number(value?.toString?.() || value || 0);

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(String(value || "0"));

const getMiningDate = (dateVal) => {
  if (!dateVal) return new Date().toISOString().split("T")[0];
  if (typeof dateVal === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    return new Date(dateVal).toISOString().split("T")[0];
  }
  if (dateVal instanceof Date) return dateVal.toISOString().split("T")[0];
  return new Date().toISOString().split("T")[0];
};

const parseMiningDateStart = (miningDate) => {
  return new Date(`${miningDate}T00:00:00.000Z`);
};

const parseMiningDateEnd = (miningDate) => {
  return new Date(`${miningDate}T23:59:59.999Z`);
};

const toUtcDateOnly = (date) => {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
};

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const getFirstEligibleMiningDate = (stakedAt) => {
  const stakeDateOnly = toUtcDateOnly(new Date(stakedAt));
  return addDays(stakeDateOnly, 1); // next day after stake
};

const isNftEligibleForMiningDate = (nft, miningDate) => {
  if (!nft || nft.status !== "STAKED") {
    return {
      eligible: false,
      reason: "NFT_NOT_STAKED",
    };
  }

  if (!nft.stakedAt) {
    return {
      eligible: false,
      reason: "NFT_STAKED_AT_MISSING",
    };
  }

  const miningDateStart = parseMiningDateStart(miningDate);
  const firstEligibleDate = getFirstEligibleMiningDate(nft.stakedAt);

  if (miningDateStart < firstEligibleDate) {
    return {
      eligible: false,
      reason: "MINING_DATE_BEFORE_STAKE_ELIGIBILITY",
      firstEligibleMiningDate: firstEligibleDate.toISOString().slice(0, 10),
    };
  }

  if (nft.unstakedAt) {
    const unstakeDateOnly = toUtcDateOnly(new Date(nft.unstakedAt));

    // If user unstaked on or before miningDate, do not mine for that date.
    if (miningDateStart >= unstakeDateOnly) {
      return {
        eligible: false,
        reason: "NFT_UNSTAKED_BEFORE_OR_ON_MINING_DATE",
      };
    }
  }

  return {
    eligible: true,
    reason: "ELIGIBLE",
  };
};

const calculateDailyMinedTsc = (nft) => {
  const miningPower = toNumber(nft.miningPower);
  const dailyYieldRatePercent = toNumber(nft.dailyYieldRatePercent);
  const powerCoefficient = toNumber(nft.powerCoefficient);
  const currentPoolMultiplier = toNumber(nft.currentPoolMultiplier);

  if (
    miningPower <= 0 ||
    dailyYieldRatePercent <= 0 ||
    powerCoefficient <= 0 ||
    currentPoolMultiplier <= 0
  ) {
    return 0;
  }

  // Formula: miningPower * (dailyYieldRatePercent / 100) * powerCoefficient * currentPoolMultiplier
  return (
    miningPower *
    (dailyYieldRatePercent / 100) *
    powerCoefficient *
    currentPoolMultiplier
  );
};


const runDailyTscMining = async ({ miningDate, triggeredBy = "SYSTEM" } = {}) => {
  const formattedDate = getMiningDate(miningDate);

  // 1. Get all staked & previously staked (unstaked) NFTs to evaluate eligibility
  const stakedNfts = await UserNft.find({ status: { $in: ["STAKED", "UNSTAKED"] } });

  const summary = {
    miningDate: formattedDate,
    totalStakedNfts: stakedNfts.length,
    processed: 0,
    skipped: 0,
    totalMinedTsc: 0,
    errors: [],
  };

  const skippedItems = [];

  if (stakedNfts.length === 0) {
    summary.skippedItems = skippedItems;
    summary.skippedDetails = skippedItems;
    return summary;
  }

  const client = mongoose.connection.getClient();
  const topologyType = client?.topology?.description?.type;
  const useTransaction =
    topologyType === "ReplicaSetWithPrimary" ||
    topologyType === "ReplicaSetNoPrimary" ||
    topologyType === "Sharded";

  for (const nft of stakedNfts) {
    const idempotencyKey = `NFT_MINING:${nft._id.toString()}:${formattedDate}`;

    try {
      // Check NFT mining eligibility
      const eligibility = isNftEligibleForMiningDate(nft, formattedDate);
      if (!eligibility.eligible) {
        summary.skipped += 1;
        skippedItems.push({
          userNft: nft._id.toString(),
          reason: eligibility.reason,
          firstEligibleMiningDate: eligibility.firstEligibleMiningDate || null,
        });
        continue;
      }

      // Pre-check idempotency outside transaction
      const existing = await MiningSnapshot.findOne({
        userNft: nft._id,
        miningDate: formattedDate,
      });

      if (existing) {
        summary.skipped += 1;
        continue;
      }

      // Check NFT parameters
      const miningPower = toNumber(nft.miningPower);
      const dailyYieldRatePercent = toNumber(nft.dailyYieldRatePercent);
      const powerCoefficient = toNumber(nft.powerCoefficient);
      const currentPoolMultiplier = toNumber(nft.currentPoolMultiplier);

      if (
        miningPower <= 0 ||
        dailyYieldRatePercent <= 0 ||
        powerCoefficient <= 0 ||
        currentPoolMultiplier <= 0
      ) {
        summary.errors.push({
          nftId: nft._id.toString(),
          error: "INVALID_PARAMETERS",
          message: `NFT has zero/negative metrics. Power: ${miningPower}, YieldRate: ${dailyYieldRatePercent}, Coefficient: ${powerCoefficient}, Multiplier: ${currentPoolMultiplier}`,
        });
        summary.skipped += 1;
        continue;
      }

      const minedTsc = calculateDailyMinedTsc(nft);
      if (minedTsc <= 0) {
        summary.errors.push({
          nftId: nft._id.toString(),
          error: "CALCULATION_ERROR",
          message: `Calculated mined TSC is 0 or negative: ${minedTsc}`,
        });
        summary.skipped += 1;
        continue;
      }

      const session = useTransaction ? await mongoose.startSession() : null;
      if (session) {
        session.startTransaction();
      }

      try {
        // Double check within transaction
        const existingTx = await MiningSnapshot.findOne({
          userNft: nft._id,
          miningDate: formattedDate,
        }).session(session);

        if (existingTx) {
          if (session) {
            await session.abortTransaction();
            session.endSession();
          }
          summary.skipped += 1;
          continue;
        }

        const formulaDesc = `${miningPower} * (${dailyYieldRatePercent} / 100) * ${powerCoefficient} * ${currentPoolMultiplier}`;

        // 1. Create MiningSnapshot
        const [snapshot] = await MiningSnapshot.create(
          [
            {
              user: nft.user,
              userNft: nft._id,
              tierCode: nft.tierCode,
              miningDate: formattedDate,
              miningPower: nft.miningPower,
              tscAllocationAmount: nft.tscAllocationAmount,
              dailyYieldRatePercent: nft.dailyYieldRatePercent,
              powerCoefficient: nft.powerCoefficient,
              poolMultiplier: nft.currentPoolMultiplier,
              minedTsc: toDecimal128(minedTsc),
              formula: formulaDesc,
              status: "POSTED",
              idempotencyKey,
              metadata: {
                triggeredBy,
                paymentAsset: nft.paymentAsset,
                paymentAmount: nft.paymentAmount?.toString() || "0",
              },
            },
          ],
          { session }
        );

        // 2. Credit ledger tscAvailable
        await creditTscAvailable({
          userId: nft.user,
          amount: minedTsc,
          type: "NFT_MINING_REWARD",
          idempotencyKey,
          referenceId: snapshot._id.toString(),
          sourceNft: nft._id,
          metadata: {
            miningDate: formattedDate,
            formula: formulaDesc,
          },
          session,
        });

        if (session) {
          await session.commitTransaction();
          session.endSession();
        }

        summary.processed += 1;
        summary.totalMinedTsc += minedTsc;
      } catch (innerError) {
        if (session) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
          session.endSession();
        }
        throw innerError;
      }
    } catch (err) {
      console.error(`Error processing mining for NFT ${nft._id}:`, err);
      summary.errors.push({
        nftId: nft._id.toString(),
        error: err.name || "UNKNOWN_ERROR",
        message: err.message || "Failed during ledger operation",
      });
    }
  }

  // Format total mined TSC to 4 decimal places
  summary.totalMinedTsc = summary.totalMinedTsc.toFixed(4);
  summary.skippedItems = skippedItems;
  summary.skippedDetails = skippedItems;

  return summary;
};

module.exports = {
  toNumber,
  toDecimal128,
  getMiningDate,
  calculateDailyMinedTsc,
  runDailyTscMining,
  isNftEligibleForMiningDate,
};

