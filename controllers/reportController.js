const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const EcosystemFee = require("../models/EcosystemFee");

exports.generateUserReport = async (req, res) => {
  try {
    await connectDB();

    // --- Only users with LP > 0 ---
    const ledgers = await Ledger.find({ "wallets.lp": { $gt: 0 } }).lean();
    const userIds = ledgers.map((l) => l.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: "No users with LP > 0 found.",
      });
    }

    const ledgerMap = Object.fromEntries(ledgers.map((l) => [l.userId.toString(), l]));

    // --- Aggregations (same logic from your script) ---
    const depositsAgg = await ChainDeposit.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amount" } } },
    ]);
    const depositMap = Object.fromEntries(depositsAgg.map((d) => [d._id.toString(), d.total]));

    const withdrawalsAgg = await ChainWithdrawal.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: "$userId", total: { $sum: "$amount" } } },
    ]);
    const withdrawalMap = Object.fromEntries(withdrawalsAgg.map((w) => [w._id.toString(), w.total]));

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
      if (e._id.type === "autoposition") ecoMap[uid].autoposition = e.total;
      else ecoMap[uid].redeemed = e.total;
      if (!ecoMap[uid].firstDate || e.firstDate < ecoMap[uid].firstDate)
        ecoMap[uid].firstDate = e.firstDate;
    });

    const autoWithFeeAgg = await EcosystemFee.aggregate([
      { $match: { userId: { $in: userIds }, ledgerRefId: { $ne: null } } },
      {
        $addFields: { ledgerRefIdObj: { $toObjectId: "$ledgerRefId" } },
      },
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
      autoWithFeeAgg.map((a) => [a._id.toString(), a.total])
    );

    const sponsorIds = users.filter((u) => u.sponsorId).map((u) => u.sponsorId);
    const sponsors = await User.find({ _id: { $in: sponsorIds } }, "username").lean();
    const sponsorMap = Object.fromEntries(sponsors.map((s) => [s._id.toString(), s.username]));

    // --- Build report data ---
    const allReports = users.map((user) => {
      const ledger = ledgerMap[user._id.toString()];
      const deposits = depositMap[user._id.toString()] || 0;
      const withdrawals = withdrawalMap[user._id.toString()] || 0;
      const sponsor = user.sponsorId ? sponsorMap[user.sponsorId.toString()] || "N/A" : "N/A";

      const lpBalance = parseFloat(ledger?.wallets?.lp?.toString() || "0.0");
      const usdtBalance = parseFloat(ledger?.wallets?.bnb?.toString() || "0.0");
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
        USDTAddress: user.wallet_address || "N/A",
        OnChainDeposits: deposits,
        OnChainWithdrawals: withdrawals,
        USDTBalance: usdtBalance,
        ZeroRiskBalance: zeroRiskBalance,
        LPBalance: lpBalance,
        TotalRewards: totalRewards,
        Redeemed: totalRewardsWithdrawal,
        CurrentBalance: currentBalance,
        AutopositioningTotal: totalRewards - currentBalance - totalRewardsWithdrawal,
        EcosystemAmount: eco.autoposition + eco.redeemed,
        AutopositionEcoFees: eco.autoposition,
        RedeemedEcoFees: eco.redeemed,
        FirstEcoFeeDate: eco.firstDate ? eco.firstDate.toISOString() : "N/A",
        AutopositionedWithFee: autoWithFee,
      };
    });

    allReports.sort((a, b) => b.LPBalance - a.LPBalance);

    // --- Create Excel Workbook in memory ---
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("User Reports");

    const headers = Object.keys(allReports[0]);
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "4F81BD" } };

    allReports.forEach((report) => worksheet.addRow(Object.values(report)));

    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    // --- Stream file directly to browser ---
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="all_users_report.xlsx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    await workbook.xlsx.write(res);
    res.end();

    
  } catch (err) {
    console.error("Error generating user report:", err);
    res.status(500).json({
      success: false,
      message: "Error generating user report",
      error: err.message,
    });
  }
};
