const mongoose = require("mongoose");
const User = require("../models/User");
const Decimal128 = mongoose.Types.Decimal128;
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");

const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  ensureDecimal128,
  compareDecimal128,
  minDecimal128,
  maxDecimal128,
} = require("../utils/decimal128Utils");



const getDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      entryType, // "DEPOSIT" | "WITHDRAWAL" | "all" or undefined
      page = 1,
      limit = 20,
      startDate,
      endDate,
    } = req.query;

    const baseFilter = { userId };
    if (startDate || endDate) {
      baseFilter.txDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        baseFilter.txDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999); // Fix: include full day
        baseFilter.txDate.$lte = end;
      }
    }
    // Total deposit amount
const [depositSummary] = await ChainDeposit.aggregate([
  { $match: baseFilter },
  {
    $group: {
      _id: null,
      totalAmount: { $sum: "$amountXRP" },
    },
  },
]);

// Total withdrawal amount
const [withdrawalSummary] = await ChainWithdrawal.aggregate([
  { $match: baseFilter },
  {
    $group: {
      _id: null,
      totalAmount: { $sum: "$amountXRP" },
    },
  },
]);

const totalDeposits = depositSummary?.totalAmount || 0;
const totalWithdrawals = withdrawalSummary?.totalAmount || 0;


    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let transactions = [];
    let totalEntries = 0;

    if (entryType === "DEPOSIT") {
      totalEntries = await ChainDeposit.countDocuments(baseFilter);
      const deposits = await ChainDeposit.find(baseFilter)
        .select("txHash amountXRP txDate source destination")
        .sort({ txDate: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

      transactions = deposits.map((tx) => ({ ...tx, type: "DEPOSIT" }));
    } else if (entryType === "WITHDRAWAL") {
      totalEntries = await ChainWithdrawal.countDocuments(baseFilter);
      const withdrawals = await ChainWithdrawal.find(baseFilter)
        .select("txHash amountXRP txDate source destination")
        .sort({ txDate: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

      transactions = withdrawals.map((tx) => ({ ...tx, type: "WITHDRAWAL" }));
    } else {
      // If no entryType or "all", fetch both and paginate manually (in-memory pagination)
      const [deposits, withdrawals] = await Promise.all([
        ChainDeposit.find(baseFilter)
          .select("txHash amountXRP txDate source destination")
          .lean(),
        ChainWithdrawal.find(baseFilter)
          .select("txHash amountXRP txDate source destination")
          .lean(),
      ]);

      const allTx = [
        ...deposits.map((tx) => ({ ...tx, type: "DEPOSIT" })),
        ...withdrawals.map((tx) => ({ ...tx, type: "WITHDRAWAL" })),
      ];

      // Sort & paginate in-memory
      allTx.sort((a, b) => new Date(b.txDate) - new Date(a.txDate));
      totalEntries = allTx.length;
      transactions = allTx.slice(skip, skip + limitNum);
    }

    const totalPages = Math.ceil(totalEntries / limitNum);

    return res.status(200).json({
      success: true,
      data: transactions,
       totalDeposits,
       totalWithdrawals,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalEntries,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("[getDetails] Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching transaction details.",
    });
  }
};

module.exports = { getDetails };


