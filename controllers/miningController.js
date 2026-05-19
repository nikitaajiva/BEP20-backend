const UserNft = require("../models/UserNft");
const MiningSnapshot = require("../models/MiningSnapshot");
const { runDailyTscMining, getMiningDate, toNumber } = require("../services/miningService");

const serializeDecimal = (value) => value?.toString?.() || "0";

const serializeSnapshot = (snapshot) => {
  const obj = snapshot.toJSON ? snapshot.toJSON() : snapshot;
  return {
    ...obj,
    miningPower: serializeDecimal(obj.miningPower),
    tscAllocationAmount: serializeDecimal(obj.tscAllocationAmount),
    dailyYieldRatePercent: serializeDecimal(obj.dailyYieldRatePercent),
    powerCoefficient: serializeDecimal(obj.powerCoefficient),
    poolMultiplier: serializeDecimal(obj.poolMultiplier),
    minedTsc: serializeDecimal(obj.minedTsc),
  };
};

exports.runDailyMining = async (req, res) => {
  try {
    const { miningDate } = req.body || {};
    const dateStr = getMiningDate(miningDate);

    console.log(`[Admin Manual Trigger] Running TSC mining for date: ${dateStr}`);
    
    const summary = await runDailyTscMining({
      miningDate: dateStr,
      triggeredBy: `ADMIN:${req.user?._id?.toString() || "UNKNOWN"}`,
    });

    return res.status(200).json({
      success: true,
      message: "Daily mining completed.",
      data: summary,
    });
  } catch (error) {
    console.error("Admin run daily mining error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to run daily mining.",
      error: error.message,
    });
  }
};

exports.getMyMiningSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const todayStr = getMiningDate();

    // 1. Fetch user's staked NFTs to calculate count and total power
    const stakedNfts = await UserNft.find({
      user: userId,
      status: "STAKED",
    });

    const totalStakedNfts = stakedNfts.length;
    let totalMiningPower = 0;
    for (const nft of stakedNfts) {
      totalMiningPower += toNumber(nft.miningPower);
    }

    // 2. Fetch all user's MiningSnapshot records to calculate total mined, today mined, and latest date
    const snapshots = await MiningSnapshot.find({
      user: userId,
      status: "POSTED",
    }).lean();

    let totalMinedTsc = 0;
    let todayMinedTsc = 0;
    let latestMiningDate = null;

    for (const snap of snapshots) {
      const minedAmount = toNumber(snap.minedTsc);
      totalMinedTsc += minedAmount;

      if (snap.miningDate === todayStr) {
        todayMinedTsc += minedAmount;
      }

      if (!latestMiningDate || snap.miningDate > latestMiningDate) {
        latestMiningDate = snap.miningDate;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        totalStakedNfts,
        totalMiningPower: totalMiningPower.toFixed(4),
        totalMinedTsc: totalMinedTsc.toFixed(4),
        todayMinedTsc: todayMinedTsc.toFixed(4),
        latestMiningDate,
      },
    });
  } catch (error) {
    console.error("Get mining summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch mining summary.",
    });
  }
};

exports.getMyMiningHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query || {};

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const query = { user: userId };

    const [items, total] = await Promise.all([
      MiningSnapshot.find(query)
        .sort({ miningDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      MiningSnapshot.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: items.map(serializeSnapshot),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Get mining history error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch mining history.",
    });
  }
};
