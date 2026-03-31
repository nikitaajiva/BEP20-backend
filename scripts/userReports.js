// scripts/userTransactionReport.js
const mongoose = require("mongoose");
const { Types } = require("mongoose");
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

async function main() {
  try {
    await connectDB();
    

    // --- Only users with LP > 0 ---
    const ledgers = await Ledger.find({ "wallets.lp": { $gt: 0 } }).lean();
    const userIds = ledgers.map(l => l.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();

    if (!users.length) {
      console.error("No users with LP > 0 found in DB.");
      process.exit(1);
    }
    

    const ledgerMap = Object.fromEntries(ledgers.map(l => [l.userId.toString(), l]));

    // --- Aggregations ---
    const depositsAgg = await ChainDeposit.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } }
    ]);
    const depositMap = Object.fromEntries(depositsAgg.map(d => [d._id.toString(), d.total]));

    const withdrawalsAgg = await ChainWithdrawal.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amountXRP" } } }
    ]);
    const withdrawalMap = Object.fromEntries(withdrawalsAgg.map(w => [w._id.toString(), w.total]));

    const ecoAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: {
            userId: "$userId",
            type: {
              $cond: [
                { $regexMatch: { input: "$narrative", regex: /autopositioning/i } },
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
      if (!ecoMap[uid]) ecoMap[uid] = { autoposition: 0, redeemed: 0, firstDate: null };
      if (e._id.type === "autoposition") {
        ecoMap[uid].autoposition = e.total;
      } else {
        ecoMap[uid].redeemed = e.total;
      }
      if (!ecoMap[uid].firstDate || e.firstDate < ecoMap[uid].firstDate) {
        ecoMap[uid].firstDate = e.firstDate;
      }
    });

const autoWithFeeAgg = await EcosystemFee.aggregate([
  { $match: { userId: { $in: userIds }, ledgerRefId: { $ne: null } } },
  {
    $addFields: {
      ledgerRefIdObj: { $toObjectId: "$ledgerRefId" } // convert string → ObjectId
    }
  },
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
      total: { $sum: { $toDouble: "$ledgerRow.amount" } } // ✅ sum ledgerrows.amount
    }
  }
]);

const autoWithFeeMap = Object.fromEntries(
  autoWithFeeAgg.map(a => [a._id.toString(), a.total])
);


    const autoAgg = await LedgerRow.aggregate([
      { $match: { userId: { $in: userIds }, eventType: "AUTOPOSITIONING" } },
      { $group: { _id: "$userId", total: { $sum: { $toDouble: "$amount" } } } }
    ]);
    const autoMap = Object.fromEntries(autoAgg.map(a => [a._id.toString(), a.total]));

    const sponsorIds = users.filter(u => u.sponsorId).map(u => u.sponsorId);
    const sponsors = await User.find({ _id: { $in: sponsorIds } }, "username").lean();
    const sponsorMap = Object.fromEntries(sponsors.map(s => [s._id.toString(), s.username]));

    // --- Build reports ---
    const allReports = users.map(user => {
      const ledger = ledgerMap[user._id.toString()];
      const deposits = depositMap[user._id.toString()] || 0;
      const withdrawals = withdrawalMap[user._id.toString()] || 0;
      const sponsor = user.sponsorId ? sponsorMap[user.sponsorId.toString()] || "N/A" : "N/A";

      const lpBalance = parseFloat(ledger?.wallets?.lp?.toString() || "0.0");
      const xamanBalance = parseFloat(ledger?.wallets?.xaman?.toString() || "0.0");
      const zeroRiskBalance = parseFloat(ledger?.wallets?.zeroRisk?.toString() || "0.0");
      const currentBalance = parseFloat(ledger?.wallets?.communityRewards?.toString() || "0.0");
      const totalRewardsWithdrawal = parseFloat(ledger?.totalRewardsWithdrawal || 0);
      const totalRewards = parseFloat(ledger?.limits?.fiveXLimit?.used || 0);

      const eco = ecoMap[user._id.toString()] || { autoposition: 0, redeemed: 0, firstDate: null };
      const autoWithFee = autoWithFeeMap[user._id.toString()] || 0;

      return {
        UHID: user.uhid,
        Username: user.username || "N/A",
        Email: user.email || "N/A",
        Sponsor: sponsor,
        XRPAddress: user.xrpAddress || "N/A",
        OnChainDeposits: deposits,
        OnChainWithdrawals: withdrawals,
        XAMANBalance: xamanBalance,
        ZeroRiskBalance: zeroRiskBalance,
        LPBalance: lpBalance,
        TotalRewards: totalRewards,
        Redeemed: totalRewardsWithdrawal,
        CurrentBalance: currentBalance,
        AutopositioningTotal: (totalRewards - currentBalance - totalRewardsWithdrawal),
        EcosystemAmount: (eco.autoposition + eco.redeemed),
        AutopositionEcoFees: eco.autoposition,
        RedeemedEcoFees: eco.redeemed,
        FirstEcoFeeDate: eco.firstDate ? eco.firstDate.toISOString() : "N/A",
        AutopositionedWithFee: autoWithFee
      };
    });

    // --- Sort by LPBalance descending ---
    allReports.sort((a, b) => b.LPBalance - a.LPBalance);

    // --- Save to Excel ---
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

    const filePath = path.join(reportsDir, `all_users_report.xlsx`);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("User Reports");

    // Headers
    const headers = Object.keys(allReports[0]);
    worksheet.addRow(headers);

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "4F81BD" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 20;

    // Data rows
    allReports.forEach(report => {
      worksheet.addRow(Object.values(report));
    });

    // Format numeric columns
    const numericCols = headers.filter(h => !["UHID","Username","Email","Sponsor","XRPAddress","FirstEcoFeeDate"].includes(h));
    numericCols.forEach(h => {
      const colIndex = headers.indexOf(h) + 1;
      worksheet.getColumn(colIndex).numFmt = "#,##0.00";
    });

    // Auto column widths
    headers.forEach((header, i) => {
      let maxLength = header.length;
      worksheet.getColumn(i + 1).eachCell({ includeEmpty: true }, cell => {
        if (cell.value) maxLength = Math.max(maxLength, cell.value.toString().length);
      });
      worksheet.getColumn(i + 1).width = maxLength + 4;
    });

    // Conditional formatting: LPBalance > 1000 highlight green
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const lpCell = row.getCell(headers.indexOf("LPBalance") + 1);
        if (parseFloat(lpCell.value) > 1000) {
          lpCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "C6EFCE" } };
          lpCell.font = { color: { argb: "006100" } };
        }
      }
    });

    // Freeze header row
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    await workbook.xlsx.writeFile(filePath);
    

    await mongoose.disconnect();
    
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
