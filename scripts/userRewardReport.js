// scripts/userRewardReport.js
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const connectDB = require("../config/db");
const ExcelJS = require("exceljs");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const EcosystemFee = require("../models/EcosystemFee");

/* =====================================================
   SAFE NUMBER NORMALIZER (NO SCIENTIFIC NOTATION)
===================================================== */
const toNumber = (val, decimals = 8) => {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(decimals));
};

async function main() {
  try {
    await connectDB();
    console.log("✅ Connected to DB");

    /* =====================================================
       STEP 1: USERS WITH ANY FINANCIAL ACTIVITY
       (Autopositioning OR Onchain OR FiveX used OR LP > 0)
    ===================================================== */
    const [
      autoUsers,
      depositUsers,
      withdrawalUsers,
      fiveXUsers,
      lpUsers,
    ] = await Promise.all([
      // AUTOPOSITIONING USERS
      LedgerRow.aggregate([
        { $match: { eventType: "AUTOPOSITIONING" } },
        { $group: { _id: "$userId" } },
      ]),

      // ON-CHAIN DEPOSIT USERS
      ChainDeposit.aggregate([{ $group: { _id: "$userId" } }]),

      // ON-CHAIN WITHDRAWAL USERS
      ChainWithdrawal.aggregate([{ $group: { _id: "$userId" } }]),

      // FIVE-X USED USERS
      Ledger.aggregate([
        { $match: { "limits.fiveXLimit.used": { $gt: 0 } } },
        { $group: { _id: "$userId" } },
      ]),

      // LP HOLDERS
      Ledger.aggregate([
        { $match: { "wallets.lp": { $gt: 0 } } },
        { $group: { _id: "$userId" } },
      ]),
    ]);

    const userIdSet = new Set(
      [...autoUsers, ...depositUsers, ...withdrawalUsers, ...fiveXUsers, ...lpUsers].map(
        (u) => u._id.toString()
      )
    );

    const userIds = [...userIdSet].map((id) => new mongoose.Types.ObjectId(id));

    if (!userIds.length) {
      console.error("❌ No financially active users found.");
      process.exit(1);
    }

    console.log(`📊 Financially active users: ${userIds.length}`);

    /* =====================================================
       STEP 2: FETCH LEDGERS + USERS
    ===================================================== */
    const ledgers = await Ledger.find({ userId: { $in: userIds } }).lean();

    const ledgerUserIds = ledgers.map((l) => l.userId);
    if (!ledgerUserIds.length) {
      console.error("❌ No ledgers found for selected users.");
      process.exit(1);
    }

    const users = await User.find({ _id: { $in: ledgerUserIds } }).lean();

    console.log(`👤 Users loaded: ${users.length}`);

    const ledgerMap = Object.fromEntries(ledgers.map((l) => [l.userId.toString(), l]));

    const finalUserIds = users.map((u) => u._id); // ensure we only report users we actually fetched

    /* =====================================================
       STEP 3: AUTOPOSITIONING TOTAL + COUNT (SOURCE OF TRUTH)
    ===================================================== */


        /* =====================================================
   STEP 3.2: AUTOPOSITIONING AFTER 2026-01-11
===================================================== */
const cutoffDate = new Date("2026-01-10T00:00:00.000Z");

const autopositionAfterAgg = await LedgerRow.aggregate([
  {
    $match: {
      userId: { $in: finalUserIds },
      eventType: "AUTOPOSITIONING",
      ts: { $gte: cutoffDate },
    },
  },
  {
    $group: {
      _id: "$userId",
      totalAfter2026: {
        $sum: {
          $cond: [
            { $eq: [{ $type: "$amount" }, "decimal"] },
            { $toDouble: "$amount" },
            "$amount",
          ],
        },
      },
    },
  },
]);

const autopositionAfterMap = Object.fromEntries(
  autopositionAfterAgg.map((a) => [
    a._id.toString(),
    toNumber(a.totalAfter2026),
  ])
);


    const autopositionAgg = await LedgerRow.aggregate([
      {
        $match: {
          userId: { $in: finalUserIds },
          eventType: "AUTOPOSITIONING",
        },
      },
      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: { $toDouble: "$amount" } },
          count: { $sum: 1 },
        },
      },
    ]);

const autopositionMap = Object.fromEntries(
  autopositionAgg.map((a) => {
    const userId = a._id.toString();
    const totalAllTime = toNumber(a.totalAmount);
    const totalAfter2026 = autopositionAfterMap[userId] || 0;

    return [
      userId,
      {
        total: toNumber(totalAllTime - totalAfter2026), // 👈 FINAL VALUE
        totalAllTime,
        totalAfter2026,
        count: a.count,
      },
    ];
  })
);





    /* =====================================================
       STEP 3.5: SAVE AUTOPOSITIONING INTO LEDGER.WALLETS
       (Schema-safe via $set)
       NOTE: Only updates users who have AUTOPOSITIONING rows.
    ===================================================== */
    // const bulkOps = [];
    // for (const [userId, auto] of Object.entries(autopositionMap)) {
    //   bulkOps.push({
    //     updateOne: {
    //       filter: { userId: new mongoose.Types.ObjectId(userId) },
    //       update: { $set: { "wallets.autopositionting": auto.total } },
    //     },
    //   });
    // }

    // if (bulkOps.length) {
    //   const res = await Ledger.bulkWrite(bulkOps);
    //   console.log(`💾 Autopositioning saved for ${res.modifiedCount} ledgers`);
    // } else {
    //   console.log("ℹ️ No AUTOPOSITIONING rows found to persist into ledgers.wallets.autopositionting");
    // }

    /* =====================================================
       STEP 4: OTHER AGGREGATIONS
    ===================================================== */
    const depositsAgg = await ChainDeposit.aggregate([
      { $match: { userId: { $in: finalUserIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
    ]);
    const depositMap = Object.fromEntries(
      depositsAgg.map((d) => [d._id.toString(), toNumber(d.total)])
    );

    const withdrawalsAgg = await ChainWithdrawal.aggregate([
      { $match: { userId: { $in: finalUserIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } },
    ]);
    const withdrawalMap = Object.fromEntries(
      withdrawalsAgg.map((w) => [w._id.toString(), toNumber(w.total)])
    );

    const ecoAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: finalUserIds } } },
      {
        $group: {
          _id: {
            userId: "$userId",
            type: {
              $cond: [
                {
                  $regexMatch: {
                    input: "$narrative",
                    regex: /autopositioning/i,
                  },
                },
                "autoposition",
                "redeemed",
              ],
            },
          },
          total: { $sum: { $toDouble: "$amount" } },
          firstDate: { $min: "$ts" },
        },
      },
    ]);

    const ecoMap = {};
    ecoAgg.forEach((e) => {
      const uid = e._id.userId.toString();
      if (!ecoMap[uid]) ecoMap[uid] = { autoposition: 0, redeemed: 0, firstDate: null };
      ecoMap[uid][e._id.type] = toNumber(e.total);
      if (!ecoMap[uid].firstDate || (e.firstDate && e.firstDate < ecoMap[uid].firstDate)) {
        ecoMap[uid].firstDate = e.firstDate;
      }
    });

    const autoWithFeeAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: finalUserIds }, ledgerRefId: { $ne: null } } },
      { $addFields: { ledgerRefIdObj: { $toObjectId: "$ledgerRefId" } } },
      {
        $lookup: {
          from: "ledgerrows",
          localField: "ledgerRefIdObj",
          foreignField: "_id",
          as: "ledgerRow",
        },
      },
      { $unwind: "$ledgerRow" },
      { $match: { "ledgerRow.eventType": "AUTOPOSITIONING" } },
      {
        $group: {
          _id: "$userId",
          total: { $sum: { $toDouble: "$ledgerRow.amount" } },
        },
      },
    ]);

    const autoWithFeeMap = Object.fromEntries(
      autoWithFeeAgg.map((a) => [a._id.toString(), toNumber(a.total)])
    );

    const sponsorIds = users.filter((u) => u.sponsorId).map((u) => u.sponsorId);
    const sponsors = sponsorIds.length
      ? await User.find({ _id: { $in: sponsorIds } }, "username").lean()
      : [];
    const sponsorMap = Object.fromEntries(sponsors.map((s) => [s._id.toString(), s.username]));

    /* =====================================================
       STEP 5: BUILD REPORT (FINAL OUTPUT)
    ===================================================== */
    const reports = users.map((user) => {
      const ledger = ledgerMap[user._id.toString()] || {};
      const eco = ecoMap[user._id.toString()] || { autoposition: 0, redeemed: 0, firstDate: null };
      const autoposition = autopositionMap[user._id.toString()] || { total: 0, count: 0 };

      const lpBalance = toNumber(ledger?.wallets?.lp);
      const xamanBalance = toNumber(ledger?.wallets?.xaman);
      const zeroRiskBalance = toNumber(ledger?.wallets?.zeroRisk);
      const currentBalance = toNumber(ledger?.wallets?.communityRewards);
      const currentLP = toNumber(ledger?.wallets?.lp);

      const redeemed = toNumber(ledger?.totalRewardsWithdrawal);

      const limits = ledger?.limits || {};
      const fiveXUsed = toNumber(limits?.fiveXLimit?.used);
      const fiveXCap = toNumber(limits?.fiveXLimit?.cap);

      // Sum of ALL limits.used (audit)
      const lpUsed = toNumber(limits?.lpLimit?.used);
      const boostUsed = toNumber(limits?.boostLimit?.used);
      const cascadeUsed = toNumber(limits?.cascadeLimit?.used);
      const zeroRiskUsed = toNumber(limits?.zeroRiskLimit?.used);
      const airdropUsed = toNumber(limits?.airdropLimit?.used);
      const xBonusUsed = toNumber(limits?.xBonusLimit?.used);
      const xMenUsed = toNumber(limits?.xMenLimit?.used);
      const xPowerUsed = toNumber(limits?.xPowerLimit?.used);
      const boosterUsed = toNumber(limits?.boosterLimit?.used);
      const swiftUsed = toNumber(limits?.swiftLimit?.used);

      const sumOfLimitsUsed = toNumber(
        lpUsed +
          boostUsed +
          cascadeUsed +
          zeroRiskUsed +
          airdropUsed +
          xBonusUsed +
          xMenUsed +
          xPowerUsed +
          boosterUsed +
          swiftUsed
      );

      const fiveXDiff = toNumber(fiveXUsed - sumOfLimitsUsed);
      const fiveXUtilizationPct =
        fiveXCap > 0 ? toNumber((fiveXUsed / fiveXCap) * 100, 2) : 0;

      const fiveXStatus = Math.abs(fiveXDiff) < 0.01 ? "OK" : "MISMATCH";
      const riskFlag =
        fiveXCap > 0 && fiveXUsed > fiveXCap
          ? "OVER_LEVERAGED"
          : fiveXUtilizationPct > 90
          ? "HIGH_RISK"
          : "SAFE";

      return {
        UHID: user.uhid,
        Username: user.username || "N/A",
        Email: user.email || "N/A",
        Sponsor: sponsorMap[user.sponsorId?.toString()] || "N/A",
        XRPAddress: user.xrpAddress || "N/A",

        OnChainDeposits: toNumber(depositMap[user._id.toString()]),
        OnChainWithdrawals: toNumber(withdrawalMap[user._id.toString()]),

        XAMANBalance: xamanBalance,
        ZeroRiskBalance: zeroRiskBalance,
        LPBalance: lpBalance,

        // FiveX fields
        FiveX_Cap: fiveXCap,
        FiveX_Used: fiveXUsed,

        // Per-limit used fields (audit columns)
        Used_LP: lpUsed,
        Used_Boost: boostUsed,
        Used_Cascade: cascadeUsed,
        Used_ZeroRisk: zeroRiskUsed,
        Used_Airdrop: airdropUsed,
        Used_XBonus: xBonusUsed,
        Used_XMen: xMenUsed,
        Used_XPower: xPowerUsed,
        Used_Booster: boosterUsed,
        Used_Swift: swiftUsed,

        Sum_Of_All_Limits: sumOfLimitsUsed,
        FiveX_Difference: fiveXDiff,
        FiveX_Utilization_Percent: fiveXUtilizationPct,
        FiveX_Status: fiveXStatus,
        Risk_Flag: riskFlag,

        Redeemed: redeemed,
        CurrentBalance: currentBalance,
        CurrentLp: currentLP,
        // Autopositioning
        AutopositioningSum: autoposition.total,
        AutopositioningCount: autoposition.count,

        // Your existing derived fields
        AutopositioningTotal: toNumber(fiveXUsed - currentBalance - redeemed),

        EcosystemAmount: toNumber(eco.autoposition + eco.redeemed),
        AutopositionEcoFees: toNumber(eco.autoposition),
        RedeemedEcoFees: toNumber(eco.redeemed),

        FirstEcoFeeDate: eco.firstDate ? eco.firstDate.toISOString() : "N/A",

        AutopositionedWithFee: toNumber(autoWithFeeMap[user._id.toString()]),
      };
    });

    // Keep your existing sort (LPBalance desc)
    reports.sort((a, b) => b.LPBalance - a.LPBalance);

    if (!reports.length) {
      console.error("❌ Report is empty after building rows.");
      process.exit(1);
    }

    /* =====================================================
       STEP 6: EXPORT TO EXCEL
    ===================================================== */
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const filePath = path.join(reportsDir, "financial_activity_users_report.xlsx");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("User Reports");

    const headers = Object.keys(reports[0]);
    sheet.addRow(headers).font = { bold: true };

    reports.forEach((r) => sheet.addRow(Object.values(r)));

    sheet.views = [{ state: "frozen", ySplit: 1 }];

    await workbook.xlsx.writeFile(filePath);

    console.log(`✅ Report generated: ${filePath}`);

    await mongoose.disconnect();
    console.log("✅ Done");
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

main();
