const Level = require("../models/Level.js");
const UserInfo = require("../models/UserInfo.js");
const User = require("../models/User.js");
const Ledger = require("../models/Ledger.js");
// const UserSignUp = require("../models/UserSignUp.js");
const { Decimal128 } = require("mongoose").Types;

async function fetchAndMergeReferralData(
  uhidList,
  level,
  viewerUhid,
  parentUhid,
  search = null
) {
  if (!uhidList || uhidList.length === 0) {
    return [];
  }

  const projection = {
    _id: 1,
    uhid: 1,
    username: 1,
    email: 1, // Added for identifying accounts created by the same person
    registrationTs: 1,
    xRank: 1,
    teamSize: { $ifNull: ["$communitySize", 0] },
    selfLp: { $ifNull: ["$ledger.wallets.lp", new Decimal128("0")] },
    teamLp: { $ifNull: ["$counters.totalTeamLp", new Decimal128("0")] },
    country: { $ifNull: ["$country.name", "N/A"] },
    sponsorUsername: { $ifNull: ["$sponsorInfo.username", "N/A"] },
    sponsorUhid: { $ifNull: ["$sponsorInfo.uhid", "N/A"] }, // Added for clarity
    boostLimit: { $ifNull: ["$ledger.limits.boostLimit.cap", new Decimal128("0")] },
    boost: { $ifNull: ["$ledger.wallets.boost", Decimal128.fromString("0")] },
  };

  // Keep whatsappContact logic as is
  if (level === 1 && viewerUhid === parentUhid) {
    projection.whatsappContact = { $ifNull: ["$whatsappContact", "N/A"] };
  } else {
    projection.whatsappContact = { $ifNull: [null, "N/A"] };
  }

  const matchQuery = { uhid: { $in: uhidList } };
  if (search && search.trim() !== "") {
    matchQuery.username = { $regex: search.trim(), $options: "i" };
  }

  const users = await User.aggregate([
    { $match: matchQuery },
    {
      $lookup: {
        from: "ledgers",
        localField: "_id",
        foreignField: "userId",
        as: "ledger",
      },
    },
    { $unwind: { path: "$ledger", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "users",
        localField: "sponsorId",
        foreignField: "_id",
        as: "sponsorInfo",
      },
    },
    { $unwind: { path: "$sponsorInfo", preserveNullAndEmptyArrays: true } },
    {
      $project: projection,
    },
  ]);

  // Aggregation returns Decimal128, so we need to convert to float for JSON
  return users.map((user) => ({
    ...user,
    selfLp: parseFloat(user.selfLp.toString()),
    teamLp: parseFloat(user.teamLp.toString()),
  }));
}

/**
 * 1️⃣ Direct descendants (level-1 children)
 * @param {string} uhid - The UHID of the parent.
 * @returns {Promise<object[]>} - Array of full user objects for descendants.
 */
async function descendants(uhid, viewerUhid, search = null) {
  const descendantUhids = await Level.find({ parent: uhid, level: 1 })
    .select("child -_id")
    .lean()
    .then((results) => results.map((d) => d.child));
  return fetchAndMergeReferralData(descendantUhids, 1, viewerUhid, uhid, search);
}

/**
 * Search for users by username (partial match)
 * @param {string} username
 * @returns {Promise<Array>} List of matching users
 */
async function searchUsername(username, currentUserId) {
  try {
    const trimmed = username?.trim();
    if (!trimmed || !currentUserId) return null;

    const regex = new RegExp(trimmed, "i"); // case-insensitive partial match

    // Step 1: Search user by username
    const user = await User.findOne({ username: regex })
      .select("_id username email uhid sponsorId")
      .lean();

    const c_sponsorUser = await User.findOne({ uhid: currentUserId })
      .select("_id")
      .lean();

    if (!c_sponsorUser) return null;

    let currentSponsor = user.sponsorId;

    while (currentSponsor) {
      if (currentSponsor.toString() === c_sponsorUser._id.toString()) {
        
        return {
          _id: user._id,
          username: user.username,
          email: user.email,
          uhid: user.uhid,
        };
        
      }

      const sponsorUser = await User.findById(currentSponsor)
        .select("sponsorId")
        .lean();
      if (!sponsorUser) break;
      
      currentSponsor = sponsorUser.sponsorId;
    }

    return null;
  } catch (err) {
    console.error("Error in searchUsername:", err);
    return null;
  }
}
/**
 * 2️⃣ Descendants at an arbitrary level
 * @param {string} uhid - The UHID of the parent.
 * @param {number} levelN - The specific level of descendants to find.
 * @returns {Promise<object[]>} - Array of full user objects for descendants at that level.
 */

async function getSelfLpSumUpToLevel(targetUhid, levelN, viewerUhid) {
  let levelSelfLpSum = 0;

  for (let i = 1; i <= levelN; i++) {
    const descendants = await descendantsAtLevel(targetUhid, i, viewerUhid);

    const levelSum = descendants.reduce((sum, user) => {
      return sum + (parseFloat(user.selfLp) || 0);
    }, 0);

    levelSelfLpSum += levelSum;
  }

  return levelSelfLpSum.toFixed(4);
}
async function descendantsAtLevel(uhid, levelN, viewerUhid, search = null) {
  const level = parseInt(levelN, 10);
  if (isNaN(level) || level <= 0) {
    return [];
  }
  const descendantUhids = await Level.find({ parent: uhid, level: level })
    .select("child -_id")
    .lean()
    .then((results) => results.map((d) => d.child));
  return fetchAndMergeReferralData(descendantUhids, level, viewerUhid, uhid, search);
}

/**
 * 3️⃣ Sponsor (immediate parent)
 * @param {string} uhid - The UHID of the child.
 * @returns {Promise<string|null>} - The parent\'s UHID or null.
 */
async function sponsor(uhid) {
  const doc = await Level.findOne({ child: uhid, level: 1 })
    .select("parent -_id")
    .lean();
  return doc?.parent ?? null;
}

/**
 * 4️⃣ Upline at an arbitrary level
 * @param {string} uhid - The UHID of the child.
 * @param {number} levelN - The specific upline level (distance from child).
 * @returns {Promise<string|null>} - The ancestor\'s UHID at that level or null.
 */
async function uplineAtLevel(uhid, levelN) {
  const doc = await Level.findOne({ child: uhid, level: levelN })
    .select("parent -_id")
    .lean();
  return doc?.parent ?? null;
}

/**
 * 🎁 Helper: get a user's clear-text email
 * @param {string} uhid - The UHID of the user.
 * @returns {Promise<string|null>} - The user's email or null.
 */
async function emailOf(uhid) {
  const doc = await UserInfo.findOne({ uhid }).select("email -_id").lean();
  return doc?.email ?? null;
}

// If you need to export them for CommonJS if your project isn't using ES modules fully:
module.exports = {
  descendants,
  descendantsAtLevel,
  sponsor,
  uplineAtLevel,
  emailOf,
  fetchAndMergeReferralData,
  searchUsername,
  getSelfLpSumUpToLevel,
};
