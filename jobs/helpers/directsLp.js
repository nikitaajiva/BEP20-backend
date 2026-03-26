// jobs/helpers/directsLp.js
const Level = require('../../models/Level');

/** Count directs (level=1) with Ledger.wallets.lp > 9 (strict). */
async function countActiveDirectsBySponsorUhidUsingLedger(sponsorUhid, minLp = 9) {
  const result = await Level.aggregate([
    // Match only direct children (Level 1)
    { $match: { parent: sponsorUhid, level: 1 } },

    // Join with ledgers collection
    {
      $lookup: {
        from: 'ledgers',
        localField: 'child',
        foreignField: 'uhid',
        as: 'childLedger'
      }
    },
    { $unwind: '$childLedger' },

    // Convert Decimal128 to numeric
    {
      $addFields: {
        childLpDecimal: {
          $convert: {
            input: '$childLedger.wallets.lp',
            to: 'decimal',
            onNull: 0,
            onError: 0
          }
        }
      }
    },

    // ✅ Changed from $gt to $gte (>= minLp)
    { $match: { childLpDecimal: { $gte: minLp } } },

    // Count how many qualify
    { $count: 'count' }
  ]);
  return result?.[0]?.count ?? 0;
}

/** Sum LP of TOP N directs (by each direct’s Ledger.wallets.lp). */
async function sumTopNDirectsLpBySponsorUhid(sponsorUhid, topN) {
  const result = await Level.aggregate([
    // Match this sponsor’s downlines within N levels
    { $match: { parent: sponsorUhid, level: { $lte: topN } } },

    // Join with ledgers
    {
      $lookup: {
        from: "ledgers",
        localField: "child",
        foreignField: "uhid",
        as: "childLedger"
      }
    },
    { $unwind: { path: "$childLedger", preserveNullAndEmptyArrays: true } },

    // Convert Decimal128 to numeric
    {
      $addFields: {
        childLpDecimal: {
          $convert: {
            input: "$childLedger.wallets.lp",
            to: "decimal",
            onNull: 0,
            onError: 0
          }
        }
      }
    },

    // Sum up
    {
      $group: {
        _id: null,
        total: { $sum: "$childLpDecimal" }
      }
    }
  ]);

  const total = result?.[0]?.total ?? 0;
    // ✅ Show result in console
  console.log(
    `Sponsor ${sponsorUhid} | Top ${topN} Levels | Total LP = ${total}`
  );
  return typeof total === "number"
    ? total
    : Number(total.toString?.() ?? 0);
}


module.exports = {
  countActiveDirectsBySponsorUhidUsingLedger,
  sumTopNDirectsLpBySponsorUhid,
};
