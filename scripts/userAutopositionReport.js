// scripts/userTransactionReport.js
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
       STEP 1: USERS WHO HAVE AUTOPOSITIONING (AT LEAST ONCE)
    ===================================================== */
    const autoUsersAgg = await LedgerRow.aggregate([
      { $match: { eventType: "AUTOPOSITIONING" } },
      { $group: { _id: "$userId" } }
    ]);

    const autoUserIds = autoUsersAgg.map(a => a._id);

    if (!autoUserIds.length) {
      console.error("❌ No users found with AUTOPOSITIONING");
      process.exit(1);
    }

    /* =====================================================
       STEP 2: FETCH LEDGERS (OPTIONAL LP > 0 FILTER)
    ===================================================== */
    const ledgers = await Ledger.find({
      userId: { $in: autoUserIds },
      "wallets.lp": { $gt: 0 } // ❌ remove if LP condition not required
    }).lean();

    const userIds = ledgers.map(l => l.userId);

    if (!userIds.length) {
      console.error("❌ No ledgers found after filtering");
      process.exit(1);
    }

    const users = await User.find({ _id: { $in: userIds } }).lean();

    console.log(`📊 Found ${users.length} users with AUTOPOSITIONING`);

    const ledgerMap = Object.fromEntries(
      ledgers.map(l => [l.userId.toString(), l])
    );

    /* =====================================================
       STEP 3: AUTOPOSITIONING TOTAL + COUNT (SOURCE OF TRUTH)
    ===================================================== */
    const autopositionAgg = await LedgerRow.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          eventType: "AUTOPOSITIONING"
        }
      },
      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: { $toDouble: "$amount" } },
          count: { $sum: 1 }
        }
      }
    ]);

    const autopositionMap = Object.fromEntries(
      autopositionAgg.map(a => [
        a._id.toString(),
        {
          total: toNumber(a.totalAmount),
          count: a.count
        }
      ])
    );


/* =====================================================
   STEP 3.5: SAVE AUTOPOSITIONING INTO LEDGER.WALLETS
   (Schema-safe via $set)
===================================================== */

const bulkOps = [];

for (const [userId, auto] of Object.entries(autopositionMap)) {
  bulkOps.push({
    updateOne: {
      filter: { userId: new mongoose.Types.ObjectId(userId) },
      update: {
        $set: {
          "wallets.autopositionting": auto.total
        },
      },
    },
  });
}

if (bulkOps.length) {
  const res = await Ledger.bulkWrite(bulkOps);
  console.log(
    `💾 Autopositioning saved for ${res.modifiedCount} ledgers`
  );
}


    /* =====================================================
       STEP 4: OTHER AGGREGATIONS
    ===================================================== */

    const depositsAgg = await ChainDeposit.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } }
    ]);
    const depositMap = Object.fromEntries(
      depositsAgg.map(d => [d._id.toString(), toNumber(d.total)])
    );

    const withdrawalsAgg = await ChainWithdrawal.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } }
    ]);
    const withdrawalMap = Object.fromEntries(
      withdrawalsAgg.map(w => [w._id.toString(), toNumber(w.total)])
    );

    const ecoAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: {
            userId: "$userId",
            type: {
              $cond: [
                {
                  $regexMatch: {
                    input: "$narrative",
                    regex: /autopositioning/i
                  }
                },
                "autoposition",
                "redeemed"
              ]
            }
          },
          total: { $sum: { $toDouble: "$amount" } },
          firstDate: { $min: "$ts" }
        }
      }
    ]);

    const ecoMap = {};
    ecoAgg.forEach(e => {
      const uid = e._id.userId.toString();
      if (!ecoMap[uid]) {
        ecoMap[uid] = { autoposition: 0, redeemed: 0, firstDate: null };
      }
      ecoMap[uid][e._id.type] = toNumber(e.total);
      if (!ecoMap[uid].firstDate || e.firstDate < ecoMap[uid].firstDate) {
        ecoMap[uid].firstDate = e.firstDate;
      }
    });

    const autoWithFeeAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: userIds }, ledgerRefId: { $ne: null } } },
      { $addFields: { ledgerRefIdObj: { $toObjectId: "$ledgerRefId" } } },
      {
        $lookup: {
          from: "ledgerrows",
          localField: "ledgerRefIdObj",
          foreignField: "_id",
          as: "ledgerRow"
        }
      },
      { $unwind: "$ledgerRow" },
      { $match: { "ledgerRow.eventType": "AUTOPOSITIONING" } },
      {
        $group: {
          _id: "$userId",
          total: { $sum: { $toDouble: "$ledgerRow.amount" } }
        }
      }
    ]);

    const autoWithFeeMap = Object.fromEntries(
      autoWithFeeAgg.map(a => [a._id.toString(), toNumber(a.total)])
    );

    const sponsorIds = users.filter(u => u.sponsorId).map(u => u.sponsorId);
    const sponsors = await User.find(
      { _id: { $in: sponsorIds } },
      "username"
    ).lean();
    const sponsorMap = Object.fromEntries(
      sponsors.map(s => [s._id.toString(), s.username])
    );

    /* =====================================================
       STEP 5: BUILD REPORT (FINAL OUTPUT)
    ===================================================== */
    const reports = users.map(user => {
      const ledger = ledgerMap[user._id.toString()] || {};
      const eco = ecoMap[user._id.toString()] || {
        autoposition: 0,
        redeemed: 0,
        firstDate: null
      };
      const autoposition = autopositionMap[user._id.toString()] || {
        total: 0,
        count: 0
      };

      const lpBalance = toNumber(ledger?.wallets?.lp);
      const xamanBalance = toNumber(ledger?.wallets?.xaman);
      const zeroRiskBalance = toNumber(ledger?.wallets?.zeroRisk);
      const currentBalance = toNumber(ledger?.wallets?.communityRewards);
      const redeemed = toNumber(ledger?.totalRewardsWithdrawal);
      const totalRewards = toNumber(ledger?.limits?.fiveXLimit?.used);

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

        TotalRewards: totalRewards,
        Redeemed: redeemed,
        CurrentBalance: currentBalance,

        /* 🔥 NEW AUTOPOSITIONING METRICS */
        AutopositioningSum: autoposition.total,
        AutopositioningCount: autoposition.count,

        AutopositioningTotal: toNumber(
          totalRewards - currentBalance - redeemed
        ),

        EcosystemAmount: toNumber(
          eco.autoposition + eco.redeemed
        ),

        AutopositionEcoFees: toNumber(eco.autoposition),
        RedeemedEcoFees: toNumber(eco.redeemed),

        FirstEcoFeeDate: eco.firstDate
          ? eco.firstDate.toISOString()
          : "N/A",

        AutopositionedWithFee: toNumber(
          autoWithFeeMap[user._id.toString()]
        )
      };
    });

    reports.sort((a, b) => b.LPBalance - a.LPBalance);

    /* =====================================================
       STEP 6: EXPORT TO EXCEL
    ===================================================== */
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const filePath = path.join(reportsDir, "autopositioning_users_report.xlsx");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("User Reports");

    const headers = Object.keys(reports[0]);
    sheet.addRow(headers).font = { bold: true };

    reports.forEach(r => sheet.addRow(Object.values(r)));

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
