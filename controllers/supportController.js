const mongoose = require("mongoose");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const EcosystemFee = require("../models/EcosystemFee");
const LedgerRow = require("../models/LedgerRow");
const UsdtDeposit = require("../models/UsdtDeposit");
const { ethers } = require("ethers");
const { getProvider, getUsdtContract, normalizeAddress } = require("../utils/bsc");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const X1Reward = require("../models/X1Reward");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
const CascadeReward = require("../models/CascadeReward");
const XPowerReward = require("../models/XPowerReward");
const Levels = require("../models/Level");
const DailyUserLP = require("../models/DailyUserLp");
const LPRewards = require("../models/LpReward");
const { addDecimal128, ensureDecimal128 } = require("../utils/decimal128Utils");
const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const ExcelJS = require("exceljs");
const WithdrawalDepositAdjustment = require("../models/WithdrawalDepositAdjustment");

// Utility to sanitize Decimal128 fields for JSON serialization
const sanitizeDecimals = (obj) => {
  if (obj instanceof mongoose.Types.Decimal128) {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeDecimals);
  }
  if (typeof obj === "object" && obj !== null) {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = sanitizeDecimals(obj[key]);
      }
    }
  }
  return obj;
};

const toNumber = (value) => {
  if (value instanceof mongoose.Types.Decimal128) {
    return parseFloat(value.toString());
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return Number(value || 0);
};

// GET /api/support/users
exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, ...filters } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    let matchStage = {};

    // 1. Handle Status Filter
    if (status && status !== "all") {
      if (status === "active") {
        matchStage.status = { $in: ["active", "verified", null, ""] };
      } else if (status === "inactive") {
        matchStage.status = { $nin: ["active", "verified", null, ""] };
      }
    }

    // 2. Handle Search Filters (uhid, email, username, etc.)
    const searchFields = ["uhid", "email", "username", "wallet_address"];
    searchFields.forEach(field => {
      if (filters[field]) {
        matchStage[field] = { $regex: filters[field], $options: "i" };
      }
    });

    // Handle legacy/frontend field name mappings
    if (filters.xrpAddress) {
      matchStage.wallet_address = { $regex: filters.xrpAddress, $options: "i" };
    }

    const usersPipeline = [
      { $match: matchStage },
      {
        $facet: {
          paginatedResults: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $lookup: {
                from: "users",
                localField: "sponsorId",
                foreignField: "_id",
                as: "sponsorInfo",
              },
            },
            {
              $unwind: {
                path: "$sponsorInfo",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                uhid: 1,
                username: 1,
                email: 1,
                wallet_address: 1,
                userType: 1,
                status: 1,
                createdAt: 1,
                sponsorUserName: "$sponsorInfo.username",
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const results = await User.aggregate(usersPipeline);

    const users = results[0].paginatedResults;

    // This is the critical fix: using .count instead of a non-existent .total
    const totalUsers = results[0].totalCount[0]
      ? results[0].totalCount[0].count
      : 0;

    const totalPages = Math.ceil(totalUsers / limitNum);

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalUsers: totalUsers,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("API User Search Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching users.",
    });
  }
};

// GET /api/support/ledger
exports.getLedger = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID is required" });
    }

    // Determine if userId is a valid MongoDB ObjectId
    const isObjectId = mongoose.Types.ObjectId.isValid(userId);

    // Build the query based on whether it's an ObjectId or a UHID
    const query = isObjectId ? { _id: userId } : { uhid: userId };

    // Fetch user and include the firstLpDepositTs field
    const user = await User.findOne(query)
      .select("uhid firstLpDepositTs positioningRank paidRankBonuses")
      .lean();

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const ledger = await Ledger.findOne({ userId: user._id }).lean();

    if (!ledger) {
      return res
        .status(404)
        .json({ success: false, message: "Ledger not found for this user" });
    }

    // Combine data into a single response object safely
    const responseData = {
      ...ledger,
      // Add user-specific fields that are not on the ledger
      firstLpDepositTs: user.firstLpDepositTs,
      positioningRank: user.positioningRank,
      paidRankBonuses: user.paidRankBonuses,
    };

    // Sanitize the final object to convert all Decimal128 instances
    const sanitizedData = sanitizeDecimals(responseData);

    res.status(200).json({ success: true, data: sanitizedData });
  } catch (error) {
    console.error("API Ledger Fetch Error:", error);
    if (error instanceof mongoose.Error.CastError) {
      res
        .status(400)
        .json({ success: false, message: "Invalid User ID format." });
    } else {
      res.status(500).json({
        success: false,
        message: "Internal server error while fetching ledger.",
      });
    }
  }
};

// GET /api/support/ledger-rows
exports.getLedgerRows = async (req, res) => {
  try {
    const {
      narrative,
      eventType,
      fromDate,
      toDate,
      page = 1,
      limit = 25,
      sortBy = "ts",
      sortOrder = "desc",
      username,
      uhid,
      wallet,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    // Build the aggregation pipeline
    let pipeline = [];

    // 1. Initial Match Stage for non-user fields (can use indexes)
    let initialMatch = {};
    if (narrative)
      initialMatch.narrative = { $regex: narrative, $options: "i" };

    // If a specific eventType is requested, it takes precedence.
    if (eventType) {
      initialMatch.eventType = eventType;
      // If wallet is also specified, we still want to filter by it.
      if (wallet) {
        initialMatch.$or = [{ walletFrom: wallet }, { walletTo: wallet }];
      }
    } else if (wallet) {
      // Otherwise, use the wallet-specific logic.
      switch (wallet) {
        case "SWIFT":
          initialMatch.eventType = {
            $in: ["SWIFT_TRANSFER_IN", "SWIFT_TRANSFER_OUT"],
          };
          break;
        case "LP":
          initialMatch.$or = [
            { eventType: "LP_DEPOSIT_FROM_USDT" },
            { eventType: "WITHDRAWAL", walletFrom: "LP" },
          ];
          break;
        case "USDT":
          initialMatch.$or = [
            { eventType: "LP_DEPOSIT_FROM_USDT" },
            { eventType: "WITHDRAWAL", walletTo: "EXTERNAL" },
          ];
          break;
        default:
          initialMatch.$or = [{ walletFrom: wallet }, { walletTo: wallet }];
      }
    }

    if (fromDate || toDate) {
      initialMatch.ts = {};
      if (fromDate) initialMatch.ts.$gte = new Date(fromDate);
      if (toDate)
        initialMatch.ts.$lte = new Date(
          new Date(toDate).setUTCHours(23, 59, 59, 999)
        );
    }

    if (Object.keys(initialMatch).length > 0) {
      pipeline.push({ $match: initialMatch });
    }

    // 2. Lookup user information
    pipeline.push(
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      {
        $unwind: {
          // Unwind the userInfo array
          path: "$userInfo",
          preserveNullAndEmptyArrays: true, // Keep ledger rows even if user is not found
        },
      }
    );

    // 3. Match on user fields (username, uhid)
    let userMatch = {};
    if (username)
      userMatch["userInfo.username"] = { $regex: username, $options: "i" };
    if (uhid) userMatch["userInfo.uhid"] = { $regex: uhid, $options: "i" };
    if (Object.keys(userMatch).length > 0) {
      pipeline.push({ $match: userMatch });
    }

    // 4. Facet for pagination and total count
    pipeline.push({
      $facet: {
        paginatedResults: [
          { $sort: sort },
          { $skip: skip },
          { $limit: limitNum },
        ],
        totalCount: [{ $count: "count" }],
      },
    });

    const results = await LedgerRow.aggregate(pipeline);

    const ledgerRows = results[0].paginatedResults;
    const totalRecords = results[0].totalCount[0]
      ? results[0].totalCount[0].count
      : 0;
    const totalPages = Math.ceil(totalRecords / limitNum);

    const sanitizedRows = ledgerRows.map((row) => sanitizeDecimals(row));

    res.status(200).json({
      success: true,
      data: sanitizedRows,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalRecords,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("API LedgerRow Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/support/usdt-deposits
exports.getUsdtDeposits = async (req, res) => {
  try {
    const {
      status,
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const query = {};

    if (status) query.status = status;

    if (walletAddress) {
      query.wallet_address = { $regex: walletAddress, $options: "i" };
    }

    if (transactionId) {
      query.tx_hash = { $regex: transactionId, $options: "i" };
    }

    // 🗓️ Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧮 Total count & sum of amounts
    const [summary] = await UsdtDeposit.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount / 1000000 || 0;

    // 📥 Fetch paginated deposits
    const deposits = await UsdtDeposit.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: "user",
        select: "username uhid",
      })
      .lean();

    // 📊 Pagination info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    // ✅ Response
    res.status(200).json({
      success: true,
      data: deposits,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API UsdtDeposit Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};


// Util to fetch and parse USDT transfer from BSC by tx hash
const fetchAndParseUsdtTxAmount = async function (txHash) {
  try {
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return null;

    const usdt = getUsdtContract(provider);
    const decimals = await usdt.decimals();
    const transferEvent = usdt.interface.getEvent("Transfer");
    const transferTopic = usdt.interface.getEventTopic(transferEvent);

    const log = receipt.logs.find(
      (l) =>
        normalizeAddress(l.address) === normalizeAddress(usdt.target) &&
        l.topics[0] === transferTopic
    );

    if (!log) return null;

    const parsed = usdt.interface.parseLog(log);
    const source = normalizeAddress(parsed.args.from);
    const destination = normalizeAddress(parsed.args.to);
    const amount = Number(
      parseFloat(ethers.formatUnits(parsed.args.value, decimals)).toFixed(6)
    );

    return {
      source,
      destination,
      amount: bodyAmount,
      raw: receipt,
    };
  } catch (error) {
    console.error("❌ Error fetching transaction:", error.message);
    return null;
  }
};

exports.getUsdtTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: transactionId",
      });
    }

    

    const txDetails = await fetchAndParseUsdtTxAmount(transactionId);

    if (!txDetails) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found or failed to parse from BSC",
      });
    }

    const { source, destination, amount, raw } = txDetails;

    // 🔍 Find user by wallet_address (case-insensitive match, if needed)
    const user = await User.findOne({ wallet_address: source });

    return res.status(200).json({
      success: true,
      message: "Transaction details fetched successfully",
      data: {
        source,
        destination,
        amount: amount.toFixed(6),
        user: user
          ? {
            _id: user._id,
            email: user.email,
            username: user.username,
            uhid: user.uhid,
          }
          : null,
        fullTransaction: raw, // optional
      },
    });
  } catch (error) {
    console.error("❌ Error fetching BSC transaction details:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + error.message,
    });
  }
};

// Main controller
exports.addFailedUsdtDepositsToUsdt = async (req, res) => {
  try {
    const { _id, wallet_address, tx_hash } = req.body;

    console.log("➡️ Request received with:", {
      _id,
      wallet_address,
      tx_hash,
    });

    if (!_id || !wallet_address || !tx_hash) {
      console.warn("⚠️ Missing required fields");
      return res.status(400).json({
        success: false,
        message: "Required fields: _id, wallet_address, tx_hash.",
      });
    }

    const deposit = await UsdtDeposit.findOne({
      _id,
      wallet_address: wallet_address,
    });

    if (!deposit) {
      console.warn("❌ Deposit not found or already completed");
      return res.status(404).json({
        success: false,
        message: "Failed deposit not found or already processed.",
      });
    }

    if (
      deposit.wallet_address !== wallet_address ||
      deposit.tx_hash !== tx_hash
    ) {
      console.warn("❌ Deposit walletAddress or transactionId mismatch");
      return res.status(400).json({
        success: false,
        message:
          "wallet_address or tx_hash does not match the deposit record.",
      });
    }

    const userExists = await User.exists({ _id: deposit.user });
    if (!userExists) {
      console.warn("❌ User does not exist for this deposit");
      return res.status(404).json({
        success: false,
        message: "User does not exist for this deposit.",
      });
    }

    const existingLedger = await LedgerRow.findOne({
      $or: [
        { refId: deposit.tx_hash },
        { narrative: { $regex: deposit.tx_hash, $options: "i" } },
      ],
    });

    if (existingLedger) {
      console.warn("❌ Duplicate transaction found in LedgerRow");
      return res.status(400).json({
        success: false,
        message: "Transaction already exists in LedgerRow.",
      });
    }

    let amount;
    

    try {
      const transactiondata = await fetchAndParseUsdtTxAmount(tx_hash);
      

      const fetchedAmount = ensureDecimal128(transactiondata.amount);
      

      if (!fetchedAmount || parseFloat(fetchedAmount.toString()) <= 0) {
        throw new Error("Fetched amount is invalid or zero");
      }

      amount = fetchedAmount;

      deposit.amount = amount.toString();
      await deposit.save();
      
    } catch (err) {
      console.error("❌ Error fetching/parsing BSC amount:", err.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch amount from BSC: " + err.message,
      });
    }

    // Ledger entry creation
    const ledgerRow = await LedgerRow.create({
      userId: deposit.user,
      eventType: "DEPOSIT",
      walletFrom: "EXTERNAL",
      walletTo: "USDT",
      amount: ensureDecimal128(amount),
      ratePct: null,
      narrative: `Usdt wallet deposit. TxHash: ${deposit.tx_hash}`,
      refId: deposit.tx_hash,
      legacyRefIdFixed: false,
    });

    console.log("🧾 LedgerRow created:", {
      id: ledgerRow._id,
      amount: amount.toString(),
      refId: deposit.tx_hash,
    });

    // Ledger balance update
    let ledger = await Ledger.findOne({ userId: deposit.user });

    if (!ledger) {
      ledger = await Ledger.create({
        userId: deposit.user,
        wallets: {
          usdt: amount,
        },
      });
      console.log(
        "🆕 Ledger created with initial USDT balance:",
        amount.toString()
      );
    } else {
      const prevBalance = ledger.wallets.bnb?.toString() || "0";
      ledger.wallets.bnb = ensureDecimal128(
        addDecimal128(
          ledger.wallets.bnb || Decimal128.fromString("0"),
          ensureDecimal128(amount)
        )
      );
      ledger.wallets.zeroRisk = ensureDecimal128(
        addDecimal128(
          ledger.wallets.zeroRisk || Decimal128.fromString("0.000000"),
          ensureDecimal128(amount)
        )
      );
      ledger.wallets.zeroRiskIpfs = ensureDecimal128(
        addDecimal128(
          ledger.wallets.zeroRiskIpfs || Decimal128.fromString("0.000000"),
          ensureDecimal128(amount)
        )
      );

      await ledger.save();
      console.log(
        "💰 USDT balance updated from",
        prevBalance,
        "to",
        ledger.wallets.bnb.toString()
      );
    }

    // Finalize deposit
    deposit.status = "completed";
    await deposit.save();
    

    return res.status(200).json({
      success: true,
      message: "Deposit verified, marked completed, and added to USDT.",
      deliveredAmount: amount.toString(),
    });
  } catch (error) {
    console.error("❌ Internal error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + error.message,
    });
  }
};

// POST /api/support/manual-bonus
exports.grantManualBonus = async (req, res) => {
  try {
    const { userId, amount, narrative } = req.body;

    if (!userId || !amount || !narrative) {
      return res.status(400).json({
        success: false,
        message: "User ID, amount, and narrative are required.",
      });
    }

    const amountD128 = mongoose.Types.Decimal128.fromString(amount.toString());
    if (parseFloat(amountD128.toString()) <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Bonus amount must be positive." });
    }

    let query;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      query = { $or: [{ _id: userId }, { uhid: userId }] };
    } else {
      query = { uhid: userId };
    }

    const user = await User.findOne(query);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const ledger = await Ledger.findOne({ uhid: user.uhid });
    if (!ledger) {
      return res
        .status(404)
        .json({ success: false, message: "Ledger not found for this user." });
    }

    // Add to boost wallet and save
    ledger.wallets.boost = mongoose.Types.Decimal128.fromString(
      (
        parseFloat(ledger.wallets.boost.toString()) +
        parseFloat(amountD128.toString())
      ).toString()
    );
    await ledger.save();

    // Create ledger row entry
    await LedgerRow.create({
      userId: user._id,
      eventType: "BOOST_BONUS",
      amount: amountD128,
      walletTo: "BOOST",
      walletFrom: "SYSTEM",
      narrative: `Manual Bonus: ${narrative}`,
    });

    res
      .status(200)
      .json({ success: true, message: "Manual bonus granted successfully." });
  } catch (error) {
    console.error("API grantManualBonus Error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// POST /api/support/manual-airdrop
exports.grantManualAirdrop = async (req, res) => {
  try {
    const { userId, amount, narrative } = req.body;

    if (!userId || !amount || !narrative) {
      return res.status(400).json({
        success: false,
        message: "User ID, amount, and narrative are required.",
      });
    }

    const amountD128 = mongoose.Types.Decimal128.fromString(amount.toString());
    if (parseFloat(amountD128.toString()) <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Airdrop amount must be positive." });
    }

    let query;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      query = { $or: [{ _id: userId }, { uhid: userId }] };
    } else {
      query = { uhid: userId };
    }

    const user = await User.findOne(query);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    const ledger = await Ledger.findOne({ uhid: user.uhid });
    if (!ledger) {
      return res
        .status(404)
        .json({ success: false, message: "Ledger not found for this user." });
    }

    // 1️⃣ credit the AIRDROP wallet
    ledger.wallets.airdrop = addDecimal128(
      ensureDecimal128(ledger.wallets.airdrop),
      amountD128
    );

    // 2️⃣ increase airdrop limit cap by the same amount
    if (!ledger.limits) {
      ledger.limits = {};
    }
    if (!ledger.limits.airdropLimit) {
      ledger.limits.airdropLimit = {
        cap: mongoose.Types.Decimal128.fromString("0.0"),
        used: mongoose.Types.Decimal128.fromString("0.0"),
      };
    }

    ledger.limits.airdropLimit.cap = addDecimal128(
      ensureDecimal128(ledger.limits.airdropLimit.cap),
      amountD128
    );

    await ledger.save();

    // 3️⃣ create ledger row entry
    await LedgerRow.create({
      userId: user._id,
      eventType: "MANUAL_AIRDROP",
      amount: amountD128,
      walletTo: "AIRDROP",
      walletFrom: "SYSTEM",
      narrative: `Manual Airdrop: ${narrative}`,
    });

    res
      .status(200)
      .json({ success: true, message: "Manual airdrop granted successfully." });
  } catch (error) {
    console.error("API grantManualAirdrop Error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// PUT /api/support/ledger
exports.updateLedger = async (req, res) => {
  try {
    const { userId, field, value } = req.body;

    if (!userId || !field || value === undefined) {
      return res.status(400).json({
        success: false,
        message: "User ID, field, and value are required",
      });
    }

    // Prevent updating critical or non-editable fields
    if (
      field === "lp" ||
      field === "_id" ||
      field === "uhid" ||
      field === "userId" ||
      field === "createdAt" ||
      field === "updatedAt"
    ) {
      return res.status(403).json({
        success: false,
        message: `Field '${field}' cannot be updated.`,
      });
    }

    const user = await User.findById(userId).select("uhid").lean();
    if (!user || !user.uhid) {
      return res
        .status(404)
        .json({ success: false, message: "User not found or has no UHID." });
    }

    // All editable wallet fields are likely numeric and Decimal128
    let updateValue;

    // Basic validation to ensure value is a number-like string
    if (typeof value !== "string" || isNaN(parseFloat(value))) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid numeric value provided. Must be a string representing a number.",
      });
    }
    updateValue = mongoose.Types.Decimal128.fromString(value);

    const ledger = await Ledger.findOneAndUpdate(
      { uhid: user.uhid },
      { $set: { [field]: updateValue } },
      { new: true }
    ).lean();

    if (!ledger) {
      return res
        .status(404)
        .json({ success: false, message: "Ledger not found for this user." });
    }

    const sanitizedLedger = sanitizeDecimals(ledger);

    res.status(200).json({
      success: true,
      data: sanitizedLedger,
      message: `Ledger field '${field}' updated successfully.`,
    });
  } catch (error) {
    console.error("API Ledger Update Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while updating ledger.",
    });
  }
};

// DELETE /api/support/users/:userId
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid User ID format." });
    }

    const user = await User.findById(userId).select("uhid");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // If user has a UHID, delete associated ledger and ledger rows
    if (user.uhid) {
      await Ledger.deleteOne({ uhid: user.uhid });
      await LedgerRow.deleteMany({ userId: user._id });
    }

    // Finally, delete the user themselves
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: "User and all associated data have been successfully deleted.",
    });
  } catch (error) {
    console.error("API User Deletion Error:", error);
    // Avoid sending internal error details to the client
    res.status(500).json({
      success: false,
      message: "An internal server error occurred while deleting the user.",
    });
  }
};
// GET /api/support/users-summary
exports.getUsersSummary = async (req, res) => {
  try {
    const {
      activeOnly = "false",
      username,
      uhid,
      wallet_address,
      page = "1",
      limit = "10",
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    /** ------------------------------------------------------------------
     *  1. Ledger-level filters
     * ------------------------------------------------------------------*/
    const ledgerMatch = {};
    if (activeOnly === "true") {
      ledgerMatch["wallets.lp"] = {
        $gt: mongoose.Types.Decimal128.fromString("0"),
      };
    }

    /** ------------------------------------------------------------------
     *  2. Username / UHID regex filters (after user lookup)
     * ------------------------------------------------------------------*/
    const userRegexMatch = {};
    if (username)
      userRegexMatch["user.username"] = { $regex: username, $options: "i" };
    if (uhid) userRegexMatch["user.uhid"] = { $regex: uhid, $options: "i" };
    if (wallet_address)
      userRegexMatch["user.wallet_address"] = { $regex: wallet_address, $options: "i" };

    /** ------------------------------------------------------------------
     *  3. Single aggregate pipeline
     * ------------------------------------------------------------------*/
    const [result] = await Ledger.aggregate([
      { $match: ledgerMatch },

      // attach user document
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },

      // regex filters (username / uhid)
      { $match: userRegexMatch },

      // sort AFTER every filter
      { $sort: { "wallets.lp": -1 } },

      // build page + totals in parallel
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limitNum },

            // For each paged user pull all its LedgerRows and sum conditionally
            {
              $lookup: {
                from: "ledgerrows",
                let: { uid: "$userId" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  {
                    $group: {
                      _id: null,
                      /* USDT deposits (EXTERNAL -> USDT) ------------------*/
                      usdtDeposits: {
                        $sum: {
                          $cond: [
                            {
                              $and: [
                                { $eq: ["$eventType", "DEPOSIT"] },
                                { $eq: ["$walletFrom", "EXTERNAL"] },
                                { $eq: ["$walletTo", "USDT"] },
                              ],
                            },
                            "$amount",
                            0,
                          ],
                        },
                      },
                      /* CLAIMS ---------------------------------------------*/
                      claims: {
                        $sum: {
                          $cond: [
                            {
                              $and: [
                                { $eq: ["$eventType", "WITHDRAWAL"] },
                                { $eq: ["$walletTo", "EXTERNAL"] },
                              ],
                            },
                            "$amount",
                            0,
                          ],
                        },
                      },
                      /* REDEEMS --------------------------------------------*/
                      redeems: {
                        $sum: {
                          $cond: [
                            { $eq: ["$eventType", "REWARDS_REDEEMED"] },
                            "$amount",
                            0,
                          ],
                        },
                      },

                      /* AUTO_POSITION --------------------------------------*/
                      autoPositioning: {
                        $sum: {
                          $cond: [
                            {
                              $and: [
                                { $eq: ["$eventType", "AUTOPOSITIONING"] },
                                { $eq: ["$walletFrom", "COMMUNITY_REWARDS"] },
                                { $eq: ["$walletTo", "INTERNAL"] },
                              ],
                            },
                            "$amount",
                            0,
                          ],
                        },
                      },
                    },
                  },
                ],
                as: "totals",
              },
            },

            // flatten totals + default zeros where no LedgerRows exist
            {
              $addFields: {
                totals: {
                  $ifNull: [
                    { $arrayElemAt: ["$totals", 0] },
                    {
                      usdtDeposits: 0,
                      claims: 0,
                      redeems: 0,
                      withdrawals: 0,
                      autoPositioning: 0,
                    },
                  ],
                },
              },
            },

            /* --------------------------------------------------------
             * Chain Deposits & Withdrawals (BSC on-chain)
             * -------------------------------------------------------*/
            {
              $lookup: {
                from: "cDeposits",
                let: { uid: "$user._id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "chainDep",
              },
            },
            {
              $lookup: {
                from: "cWithdrawals",
                let: { uid: "$user._id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "chainWdl",
              },
            },
            /* --------------------------------------------------------
             * Credited totals
             * -------------------------------------------------------*/
            // Daily rewards credited to Community Rewards wallet
            {
              $lookup: {
                from: "ledgerrows",
                let: { uid: "$user._id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$userId", "$$uid"] },
                          {
                            $in: [
                              "$eventType",
                              [
                                "DAILY_REWARDS_LP",
                                "DAILY_REWARDS_AIRDROP",
                                "DAILY_REWARDS_BOOST",
                              ],
                            ],
                          },
                        ],
                      },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "dailyCred",
              },
            },
            // Booster Bonus credited totals
            {
              $lookup: {
                from: "communityboosterrewards",
                let: { uid: "$user._id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "boosterCred",
              },
            },
            // Ecosystem Fees total per user
            {
              $lookup: {
                from: "ecosystemfees",
                let: { uid: "$user._id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "ecoFees",
              },
            },

            // X Bonus credited totals
            {
              $lookup: {
                from: "x1rewards",
                let: { uid: "$user._id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                  { $group: { _id: null, total: { $sum: "$amount" } } },
                ],
                as: "xbonusCred",
              },
            },
            // flatten totals + default zeros where no LedgerRows exist
            {
              $addFields: {
                totals: "$totals",
                communityRewardsCredited: {
                  $ifNull: [{ $sum: "$dailyCred.total" }, 0],
                },
                communityBoosterCredited: {
                  $ifNull: [{ $sum: "$boosterCred.total" }, 0],
                },
                xBonusCredited: { $ifNull: [{ $sum: "$xbonusCred.total" }, 0] },
                chainDeposits: {
                  $ifNull: [{ $sum: "$chainDep.total" }, 0],
                },
                chainWithdrawals: {
                  $ifNull: [{ $sum: "$chainWdl.total" }, 0],
                },
              },
            },

            // final shape for each row
            {
              $project: {
                _id: 0,
                userId: "$user._id",
                username: "$user.username",
                firstLpDeposit: "$user.firstLpDepositTs",
                /* ZERO RISK AVAILABLE -----------------------------------*/
                zeroRisk: "$wallets.zeroRisk", // direct principal
                lp: "$wallets.lp",
                usdt: "$wallets.bnb",
                /* COMMUNITY REWARDS WALLET BALANCE ---------------------*/
                communityRewards: "$wallets.communityRewards",
                cascadeRewards: "$wallets.cascadeRewards", // new column

                /* TOTAL OF COMMUNITY-RELATED WALLETS -------------------*/
                communityRewardsTotal: {
                  $add: [
                    { $ifNull: ["$communityRewardsCredited", 0] },
                    { $ifNull: ["$wallets.cascadeRewards", 0] },
                    { $ifNull: ["$wallets.communityBoosterBonus", 0] },
                    { $ifNull: ["$wallets.xBonus", 0] },
                  ],
                },

                communityBoosterBonus: "$wallets.communityBoosterBonus",
                xBonus: "$wallets.xBonus",

                fiveXLimitUsed: "$limits.fiveXLimit.used",

                chainDeposits: "$chainDeposits",
                chainWithdrawals: "$chainWithdrawals",

                usdtDeposits: "$totals.usdtDeposits",
                claims: "$totals.claims",
                redeems: "$totals.redeems",
                autoPositioning: "$totals.autoPositioning",
                communityRewardsCredited: "$communityRewardsCredited",
                communityBoosterCredited: "$communityBoosterCredited",
                xBonusCredited: "$xBonusCredited",
                ecoFeesTotal: { $ifNull: [{ $sum: "$ecoFees.total" }, 0] },
              },
            },
          ],

          // total count for pagination
          total: [{ $count: "total" }],
        },
      },

      // unwrap facet
      {
        $project: {
          data: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$total.total", 0] }, 0] },
        },
      },
    ]).allowDiskUse(true); // safety on big result sets

    /** ------------------------------------------------------------------
     *  4. Send response
     * ------------------------------------------------------------------*/
    res.status(200).json({
      success: true,
      data: result.data,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(result.total / limitNum),
        totalRecords: result.total,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error("API Users Summary Error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching users summary.",
    });
  }
};

// -------------------------------------------------------------------
// Detail rows for Users-Summary modal
// GET /api/support/users-summary/detail?userId=&kind=
// -------------------------------------------------------------------
exports.getUsersSummaryDetail = async (req, res) => {
  try {
    const { userId, kind, page = 1, limit = 100 } = req.query;
    if (!userId || !kind) {
      return res
        .status(400)
        .json({ success: false, message: "userId and kind are required" });
    }

    const uid = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId;

    let Model;
    let match = { userId: uid };
    let projection;

    switch (kind) {
      case "usdtDeposits":
        Model = LedgerRow;
        Object.assign(match, {
          eventType: "DEPOSIT",
          walletFrom: "EXTERNAL",
          walletTo: "USDT",
        });
        projection = { _id: 0, ts: 1, amount: 1, refId: 1, narrative: 1 };
        break;
      case "claims":
        Model = LedgerRow;
        Object.assign(match, {
          eventType: "WITHDRAWAL",
          walletTo: "EXTERNAL",
        });
        projection = {
          _id: 0,
          ts: 1,
          amount: 1,
          transactionId: 1,
          narrative: 1,
        };
        break;
      case "redeems":
        Model = LedgerRow;
        Object.assign(match, { eventType: "REWARDS_REDEEMED" });
        projection = { _id: 0, ts: 1, amount: 1, narrative: 1 };
        break;
      case "autoPositioning":
        Model = LedgerRow;
        Object.assign(match, {
          eventType: "AUTOPOSITIONING",
          walletFrom: "COMMUNITY_REWARDS",
          walletTo: "INTERNAL",
        });
        projection = { _id: 0, ts: 1, amount: 1, narrative: 1 };
        break;
      case "communityRewards":
        Model = LedgerRow;
        Object.assign(match, {
          eventType: {
            $in: [
              "DAILY_REWARDS_LP",
              "DAILY_REWARDS_AIRDROP",
              "DAILY_REWARDS_BOOST",
            ],
          },
        });
        projection = { _id: 0, ts: 1, amount: 1, eventType: 1 };
        break;
      case "xBonus":
        Model = X1Reward;
        projection = { _id: 0, ts: 1, amount: 1, tier: 1, level: 1 };
        break;
      case "boosterBonus":
        Model = CommunityBoosterReward;
        projection = {
          _id: 0,
          createdAt: 1,
          amount: 1,
          level: 1,
          tier: 1,
          narrative: 1,
        };
        match = { userId: uid }; // override
        break;
      case "chainDeposits":
        Model = ChainDeposit;
        projection = {
          _id: 0,
          txDate: 1,
          amount: 1,
          txHash: 1,
          destination: 1,
        };
        break;
      case "chainWithdrawals":
        Model = ChainWithdrawal;
        projection = {
          _id: 0,
          txDate: 1,
          amount: 1,
          txHash: 1,
          destination: 1,
        };
        break;
      case "ecosystemfees":
        Model = EcosystemFee; // make sure you import this model at the top
        projection = {
          _id: 0,
          ts: 1,
          amount: 1,
          walletFrom: 1,
          eventType: 1,
          narrative: 1,
        };
        match = {
          userId: uid,
          eventType: "ECOSYSTEM_FEE" // optional if you only want fee entries
        };
        break;

      case "withdrawals": // combined view (claims + redeems + autoPositioning)
        Model = LedgerRow;
        Object.assign(match, {
          $or: [
            { eventType: "WITHDRAWAL", walletTo: "EXTERNAL" },
            { eventType: "REWARDS_REDEEMED" },
            {
              eventType: "WITHDRAWAL",
              walletFrom: "COMMUNITY_REWARDS",
              walletTo: "INTERNAL",
            },
          ],
        });
        projection = {
          _id: 0,
          ts: 1,
          amount: 1,
          transactionId: 1,
          narrative: 1,
        };
        break;
      default:
        return res
          .status(400)
          .json({ success: false, message: "Invalid kind parameter" });
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const sortField = ["chainDeposits", "chainWithdrawals"].includes(kind)
      ? "txDate"
      : kind === "boosterBonus"
        ? "createdAt"
        : "ts";

    const baseQuery = Model.find(match)
      .sort({ [sortField]: -1, _id: -1 })
      .skip(skip)
      .limit(limitNum);
    if (projection) baseQuery.select(projection);

    const [rows, total] = await Promise.all([
      baseQuery.lean(),
      Model.countDocuments(match),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalRecords: total,
        limit: limitNum,
      },
    });
  } catch (err) {
    console.error("UsersSummaryDetail error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/support/usdt-withdrawals

exports.getUsdtWithdrawals = async (req, res) => {
  try {
    const {
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // --- Build ChainWithdrawal filter ---
    let chainQuery = {};

    if (walletAddress) {
      chainQuery.destination = { $regex: walletAddress, $options: "i" };
    }

    if (transactionId) {
      chainQuery.txHash = { $regex: transactionId, $options: "i" };
    }

    if (startDate || endDate) {
      chainQuery.txDate = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        chainQuery.txDate.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        chainQuery.txDate.$lte = end;
      }
    }

    // 🧮 Total count & sum of withdrawal amounts
    const [summary] = await ChainWithdrawal.aggregate([
      { $match: chainQuery },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // --- Fetch chain withdrawals ---
    const chainWithdrawals = await ChainWithdrawal.find(chainQuery)
      .sort({ txDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    if (chainWithdrawals.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        summary: {
          totalRecords: 0,
          totalAmount: "0.000000",
        },
        pagination: {
          totalItems: 0,
          currentPage: parseInt(page),
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    // --- Extract txHashes and userIds ---
    const txHashes = chainWithdrawals.map((c) => c.txHash);
    const userIds = chainWithdrawals
      .map((c) => c.userId)
      .filter(Boolean)
      .map((id) => id.toString());

    // --- Fetch related LedgerRows and Users in parallel ---
    const [ledgerRows, users] = await Promise.all([
      LedgerRow.find({ refId: { $in: txHashes } }).lean(),
      User.find({ _id: { $in: userIds } }).select("username uhid").lean(),
    ]);

    // --- Map results for quick lookup ---
    const ledgerMap = new Map(ledgerRows.map((l) => [l.refId, l]));
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    // --- Merge Data ---
    const combinedData = chainWithdrawals.map((c) => {
      const ledger = ledgerMap.get(c.txHash);
      const user = userMap.get(c.userId?.toString());

      return {
        refId: c.txHash,
        amount: c.amount,
        fromWallet: c.source,
        toAddress: c.destination,
        ts: c.txDate,
        ledgerIndex: c.ledgerIndex,
        uhid: user?.uhid || c.uhid || "Unknown",
        username: user?.username || "Unknown",
        eventType: ledger?.eventType || "WITHDRAWAL_NOT_RECORDED",
        ledgerRefId: ledger?._id || null,
        ledgerAmount: ledger?.amount?.toString() || null,
        ledgerTs: ledger?.ts || null,
      };
    });

    // --- Pagination Info ---
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    // ✅ Final response
    res.status(200).json({
      success: true,
      data: combinedData,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API getUsdtWithdrawals Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/support/usdt-withdrawalerror

exports.getWithdrawalErrored = async (req, res) => {
  try {
    const {
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧩 Build query
    let query = {};
    query.errorCode = { $ne: "RESOLVED" };
    if (walletAddress) {
      query.destinationAddress = { $regex: walletAddress, $options: "i" };
    }

    if (transactionId) {
      query.uniqueTransactionId = { $regex: transactionId, $options: "i" };
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // 🧮 Total count & total amount
    const [summary] = await WithdrawalErrorLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // 📦 Fetch paginated results
    const logs = await WithdrawalErrorLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    if (logs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        summary: { totalRecords: 0, totalAmount: "0.000000" },
        pagination: {
          totalItems: 0,
          currentPage: parseInt(page),
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    // 🔍 Collect IDs for joins
    const userIds = logs.map((l) => l.userId?.toString()).filter(Boolean);
    const ledgerRowIds = logs.map((l) => l.ledgerRowId).filter(Boolean);

    // 🧠 Fetch related data
    const [users, ledgerRows] = await Promise.all([
      User.find({ _id: { $in: userIds } }).select("username uhid email").lean(),
      LedgerRow.find({ _id: { $in: ledgerRowIds } }).lean(),
    ]);

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const ledgerMap = new Map(ledgerRows.map((l) => [l._id.toString(), l]));

    // 🔗 Merge results
    const combinedData = logs.map((log) => {
      const user = userMap.get(log.userId?.toString());
      const ledger = ledgerMap.get(log.ledgerRowId?.toString());
      return {
        id: log._id,
        userId: log.userId,
        username: user?.username || "Unknown",
        uhid: user?.uhid || "N/A",
        email: user?.email || "N/A",
        walletFrom: log.walletFrom,
        destinationAddress: log.destinationAddress,
        amount: log.amount?.$numberDecimal || log.amount?.toString() || "0",
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt,
        uniqueTransactionId: log.uniqueTransactionId,
        ledgerRowId: log.ledgerRowId,
        ledgerEventType: ledger?.eventType || "N/A",
        ledgerAmount: ledger?.amount?.toString() || "N/A",
        ledgerTs: ledger?.ts || null,
      };
    });

    // 📊 Pagination Info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    // ✅ Final Response
    return res.status(200).json({
      success: true,
      data: combinedData,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("❌ API getWithdrawalErrored Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/support/usdt-claimed

exports.getUsdtClaimed = async (req, res) => {
  try {
    const {
      status,
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    // Base query
    let query = {
      eventType: "WITHDRAWAL",
      walletTo: "EXTERNAL",
      walletFrom: "ZERO_RISK",
    };

    // Wallet filter
    if (walletAddress) {
      query.narrative = { $regex: walletAddress, $options: "i" };
    }

    // Transaction filter
    if (transactionId) {
      query.refId = { $regex: transactionId, $options: "i" };
    }

    // 🗓️ Date filter (only by date, ignoring time)
    if (startDate || endDate) {
      query.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.ts.$lte = end;
      }
    }

    // Pagination setup
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧮 Total count & sum of amounts
    const [summary] = await LedgerRow.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // Fetch LedgerRows
    const withdrawals = await LedgerRow.find(query)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 🔍 Extract all txHashes (refIds)
    const txHashes = withdrawals.map((w) => w.refId).filter(Boolean);

    // Fetch corresponding cWithdrawals entries
    const relatedCWithdrawals = await ChainWithdrawal.find({
      txHash: { $in: txHashes },
    })
      .select("txHash source destination amount txDate")
      .lean();

    // Convert to lookup map
    const withdrawalMap = relatedCWithdrawals.reduce((acc, cw) => {
      acc[cw.txHash] = cw;
      return acc;
    }, {});

    // Merge details
    const transformedWithdrawals = withdrawals.map((withdrawal) => {
      const match = withdrawalMap[withdrawal.refId] || {};
      const addressMatch = withdrawal.narrative?.match(/to\s+(r[a-zA-Z0-9]{20,})/);
      const destinationAddress =
        match.destination || addressMatch?.[1] || "Unknown";

      return {
        ...withdrawal,
        toAddress: destinationAddress,
        fromWallet: match.source || "Unknown",
        amount: withdrawal.amount?.toString(),
        claimedUSDT: match.amount || null,
        txDate: match.txDate || null,
        username: withdrawal.userId?.username || "Unknown",
        uhid: withdrawal.userId?.uhid || "Unknown",
      };
    });

    // Pagination info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.status(200).json({
      success: true,
      data: transformedWithdrawals,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6), // 🧮 keep precision
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API UsdtClaimed Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};



// GET /api/support/usdt-redeemed
exports.getUsdtRedeemed = async (req, res) => {
  try {
    const {
      status,
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    // Base query
    let query = {
      eventType: "REWARDS_REDEEMED",
      walletTo: "EXTERNAL",
      walletFrom: "COMMUNITY_REWARDS",
    };

    // Wallet filter
    if (walletAddress) {
      query.narrative = { $regex: walletAddress, $options: "i" };
    }

    // Transaction filter
    if (transactionId) {
      query.refId = { $regex: transactionId, $options: "i" };
    }

    // 🗓️ Date filter (only by date, ignoring time)
    if (startDate || endDate) {
      query.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.ts.$lte = end;
      }
    }

    // Pagination setup
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧮 Total count & sum of amounts
    const [summary] = await LedgerRow.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // Fetch LedgerRows
    const withdrawals = await LedgerRow.find(query)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 🔍 Extract all txHashes (refIds)
    const txHashes = withdrawals.map((w) => w.refId).filter(Boolean);

    // Fetch corresponding cWithdrawals entries
    const relatedCWithdrawals = await ChainWithdrawal.find({
      txHash: { $in: txHashes },
    })
      .select("txHash source destination amount txDate")
      .lean();

    // Convert to lookup map
    const withdrawalMap = relatedCWithdrawals.reduce((acc, cw) => {
      acc[cw.txHash] = cw;
      return acc;
    }, {});

    // Merge details
    const transformedWithdrawals = withdrawals.map((withdrawal) => {
      const match = withdrawalMap[withdrawal.refId] || {};
      const addressMatch = withdrawal.narrative?.match(/to\s+(r[a-zA-Z0-9]{20,})/);
      const destinationAddress =
        match.destination || addressMatch?.[1] || "Unknown";

      return {
        ...withdrawal,
        toAddress: destinationAddress,
        fromWallet: match.source || "Unknown",
        amount: withdrawal.amount?.toString(),
        claimedUSDT: match.amount || null,
        txDate: match.txDate || null,
        username: withdrawal.userId?.username || "Unknown",
        uhid: withdrawal.userId?.uhid || "Unknown",
      };
    });

    // Pagination info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.status(200).json({
      success: true,
      data: transformedWithdrawals,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API UsdtRedeemed Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/support/usdt-redeemed
exports.getUsdtAutopositioning = async (req, res) => {
  try {
    const {
      status,
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    // Base query
    let query = {
      walletFrom: "COMMUNITY_REWARDS",
      eventType: "AUTOPOSITIONING",
    };

    // Wallet filter
    if (walletAddress) {
      query.narrative = { $regex: walletAddress, $options: "i" };
    }

    // Transaction filter
    if (transactionId) {
      query.refId = { $regex: transactionId, $options: "i" };
    }

    // 🗓️ Date filter (only by date, ignoring time)
    if (startDate || endDate) {
      query.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.ts.$lte = end;
      }
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧮 Total count & sum of amounts
    const [summary] = await LedgerRow.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // Data fetch
    const withdrawals = await LedgerRow.find(query)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // Transform data
    const transformedWithdrawals = withdrawals.map((withdrawal) => {
      const addressMatch = withdrawal.narrative?.match(/to\s+(r[a-zA-Z0-9]{20,})/);
      const destinationAddress = addressMatch ? addressMatch[1] : "Unknown";

      return {
        ...withdrawal,
        destinationAddress,
        amount: withdrawal.amount?.toString(),
        username: withdrawal.userId?.username || "Unknown",
        uhid: withdrawal.userId?.uhid || "Unknown",
      };
    });

    // Pagination info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    // ✅ Final response
    res.status(200).json({
      success: true,
      data: transformedWithdrawals,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API UsdtAutopositioning Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/support/usdt-redeemed
exports.getlppositioning = async (req, res) => {
  try {
    const {
      status,
      walletAddress,
      transactionId,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    // Base query
    let query = {
      walletFrom: "USDT",
      eventType: "LP_DEPOSIT_FROM_USDT",
      walletTo: "LP",
    };

    // Wallet filter
    if (walletAddress) {
      query.narrative = { $regex: walletAddress, $options: "i" };
    }

    // Transaction filter
    if (transactionId) {
      query.refId = { $regex: transactionId, $options: "i" };
    }

    // 🗓️ Date filter (only by date, ignoring time)
    if (startDate || endDate) {
      query.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        query.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.ts.$lte = end;
      }
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 🧮 Total count & sum of amounts
    const [summary] = await LedgerRow.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const totalItems = summary?.totalItems || 0;
    const totalAmount = summary?.totalAmount || 0;

    // Data fetch
    const withdrawals = await LedgerRow.find(query)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // Transform data
    const transformedWithdrawals = withdrawals.map((withdrawal) => {
      const addressMatch = withdrawal.narrative?.match(/to\s+(r[a-zA-Z0-9]{20,})/);
      const destinationAddress = addressMatch ? addressMatch[1] : "Unknown";

      return {
        ...withdrawal,
        destinationAddress,
        amount: withdrawal.amount?.toString(),
        username: withdrawal.userId?.username || "Unknown",
        uhid: withdrawal.userId?.uhid || "Unknown",
      };
    });

    // Pagination info
    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    // ✅ Final response
    res.status(200).json({
      success: true,
      data: transformedWithdrawals,
      summary: {
        totalRecords: totalItems,
        totalAmount: totalAmount.toFixed(6),
      },
      pagination: {
        totalItems,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error("API UsdtAutopositioning Search Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

//===================== Positive LP API (JSON + Autopositioning) =====================

exports.getpositivelp = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const ledgerQuery = { "wallets.lp": { $exists: true, $gt: 0 } };

    // 🔍 Search by username or UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      const userIds = matchedUsers.map((u) => u._id);
      if (userIds.length === 0)
        return res.json({
          success: true,
          data: [],
          summary: { totalRecords: 0, totalLp: "0.000000", totalZeroRisk: "0.000000" },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });
      ledgerQuery.userId = { $in: userIds };
    }

    // 🧮 Summary Totals
    const [summary] = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalLp: { $sum: { $toDouble: "$wallets.lp" } },
          totalZeroRisk: { $sum: { $toDouble: "$wallets.zeroRisk" } },
        },
      },
    ]);

    const totalRecords = summary?.totalRecords || 0;
    const totalLp = summary?.totalLp || 0;
    const totalZeroRisk = summary?.totalZeroRisk || 0;

    // 🧾 Fetch data
    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.lp": -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 💰 Fetch autopositioning per user
    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);
    const autopositions = await LedgerRow.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          eventType: "AUTOPOSITIONING",
        },
      },
      {
        $group: {
          _id: "$userId",
          totalAuto: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const autoMap = {};
    autopositions.forEach((a) => (autoMap[a._id.toString()] = a.totalAuto));

    // 🧩 Final Data
    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        lp: Number(ledger.wallets.lp).toFixed(6),
        zeroRisk: Number(ledger.wallets.zeroRisk || 0).toFixed(6),
        autopositioning: (autoMap[userIdStr] || 0).toFixed(6),
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalLp: totalLp.toFixed(6),
        totalZeroRisk: totalZeroRisk.toFixed(6),
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Positive LP Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/support/activeLp
exports.getActiveLp = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, date, parent } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    const sendEmpty = () =>
      res.json({
        success: true,
        data: [],
        summary: { totalRecords: 0, totalActiveLp: "0.000000" },
        pagination: {
          totalItems: 0,
          currentPage: 1,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
          limit: limitNumber
        }
      });

    let userIdFilter = null;

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      const matchedIds = matchedUsers.map((u) => u._id.toString());
      if (matchedIds.length === 0) {
        return sendEmpty();
      }
      userIdFilter = new Set(matchedIds);
    }

    if (date) {
      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD."
        });
      }

      const startOfDay = new Date(parsedDate);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(parsedDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const dailyRows = await DailyUserLP.find({
        date: { $gte: startOfDay, $lte: endOfDay }
      })
        .select("userId")
        .lean();

      const dateIds = dailyRows.map((d) => d.userId.toString());
      if (dateIds.length === 0) {
        return sendEmpty();
      }

      if (userIdFilter) {
        const dateSet = new Set(dateIds);
        userIdFilter = new Set(
          [...userIdFilter].filter((id) => dateSet.has(id))
        );
      } else {
        userIdFilter = new Set(dateIds);
      }

      if (userIdFilter.size === 0) {
        return sendEmpty();
      }
    }

    if (parent) {
      const parentUser = await User.findOne({ uhid: parent })
        .select("_id uhid")
        .lean();

      if (!parentUser) {
        return res.status(400).json({
          success: false,
          message: "Invalid parent"
        });
      }

      const levels = await Levels.find({ parent: parentUser.uhid })
        .select("child")
        .lean();

      const childUhids = levels.map((l) => l.child);
      childUhids.push(parentUser.uhid);

      const teamUsers = await User.find({ uhid: { $in: childUhids } })
        .select("_id")
        .lean();

      const parentIds = teamUsers.map((u) => u._id.toString());

      if (!parentIds.length) {
        return sendEmpty();
      }

      if (userIdFilter) {
        const parentSet = new Set(parentIds);
        userIdFilter = new Set(
          [...userIdFilter].filter((id) => parentSet.has(id))
        );
      } else {
        userIdFilter = new Set(parentIds);
      }

      if (userIdFilter.size === 0) {
        return sendEmpty();
      }
    }

    const matchStage = {};
    if (userIdFilter) {
      matchStage.userId = {
        $in: [...userIdFilter].map((id) => new mongoose.Types.ObjectId(id))
      };
    }

    const [results] = await Ledger.aggregate([
      { $match: matchStage },
      {
        $addFields: {
          lpValue: {
            $toDouble: { $ifNull: ["$wallets.lp", 0] }
          },
          autopositiontingValue: {
            $toDouble: { $ifNull: ["$wallets.autopositionting", 0] }
          }
        }
      },
      {
        $addFields: {
          activeLp: { $subtract: ["$lpValue", "$autopositiontingValue"] }
        }
      },
      { $match: { activeLp: { $gt: 0 } } },
      {
        $facet: {
          paginatedResults: [
            { $sort: { activeLp: -1 } },
            { $skip: skip },
            { $limit: limitNumber },
            {
              $lookup: {
                from: "users",
                localField: "userId",
                foreignField: "_id",
                as: "user"
              }
            },
            {
              $unwind: {
                path: "$user",
                preserveNullAndEmptyArrays: true
              }
            },
            {
              $project: {
                userId: 1,
                activeLp: 1,
                lpValue: 1,
                autopositiontingValue: 1,
                "user.username": 1,
                "user.uhid": 1
              }
            }
          ],
          summary: [
            {
              $group: {
                _id: null,
                totalRecords: { $sum: 1 },
                totalActiveLp: { $sum: "$activeLp" }
              }
            }
          ]
        }
      }
    ]);

    const totalRecords = results?.summary?.[0]?.totalRecords || 0;
    const totalActiveLp = results?.summary?.[0]?.totalActiveLp || 0;
    const totalPages = Math.ceil(totalRecords / limitNumber);

    const data = (results?.paginatedResults || []).map((row) => ({
      username: row.user?.username || "Unknown",
      uhid: row.user?.uhid || "Unknown",
      lp: Number(row.lpValue || 0).toFixed(6),
      autopositioning: Number(row.autopositiontingValue || 0).toFixed(6),
      activeLp: Number(row.activeLp || 0).toFixed(6)
    }));

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalActiveLp: Number(totalActiveLp || 0).toFixed(6)
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: pageNumber,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
        limit: limitNumber
      }
    });
  } catch (err) {
    console.error("Active LP Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/support/activeLp/export
exports.exportActiveLp = async (req, res) => {
  try {
    const { search, date, parent } = req.query;

    let userIdFilter = null;

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      const matchedIds = matchedUsers.map((u) => u._id.toString());
      if (matchedIds.length === 0) {
        return res.status(200).end();
      }
      userIdFilter = new Set(matchedIds);
    }

    if (date) {
      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD."
        });
      }

      const startOfDay = new Date(parsedDate);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(parsedDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const dailyRows = await DailyUserLP.find({
        date: { $gte: startOfDay, $lte: endOfDay }
      })
        .select("userId")
        .lean();

      const dateIds = dailyRows.map((d) => d.userId.toString());
      if (dateIds.length === 0) {
        return res.status(200).end();
      }

      if (userIdFilter) {
        const dateSet = new Set(dateIds);
        userIdFilter = new Set(
          [...userIdFilter].filter((id) => dateSet.has(id))
        );
      } else {
        userIdFilter = new Set(dateIds);
      }

      if (userIdFilter.size === 0) {
        return res.status(200).end();
      }
    }

    if (parent) {
      const parentUser = await User.findOne({ uhid: parent })
        .select("_id uhid")
        .lean();

      if (!parentUser) {
        return res.status(400).json({
          success: false,
          message: "Invalid parent"
        });
      }

      const levels = await Levels.find({ parent: parentUser.uhid })
        .select("child")
        .lean();

      const childUhids = levels.map((l) => l.child);
      childUhids.push(parentUser.uhid);

      const teamUsers = await User.find({ uhid: { $in: childUhids } })
        .select("_id")
        .lean();

      const parentIds = teamUsers.map((u) => u._id.toString());
      if (!parentIds.length) {
        return res.status(200).end();
      }

      if (userIdFilter) {
        const parentSet = new Set(parentIds);
        userIdFilter = new Set(
          [...userIdFilter].filter((id) => parentSet.has(id))
        );
      } else {
        userIdFilter = new Set(parentIds);
      }

      if (userIdFilter.size === 0) {
        return res.status(200).end();
      }
    }

    const matchStage = {};
    if (userIdFilter) {
      matchStage.userId = {
        $in: [...userIdFilter].map((id) => new mongoose.Types.ObjectId(id))
      };
    }

    const rows = await Ledger.aggregate([
      { $match: matchStage },
      {
        $addFields: {
          lpValue: {
            $toDouble: { $ifNull: ["$wallets.lp", 0] }
          },
          autopositiontingValue: {
            $toDouble: { $ifNull: ["$wallets.autopositionting", 0] }
          }
        }
      },
      {
        $addFields: {
          activeLp: { $subtract: ["$lpValue", "$autopositiontingValue"] }
        }
      },
      { $match: { activeLp: { $gt: 0 } } },
      { $sort: { activeLp: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          userId: 1,
          activeLp: 1,
          lpValue: 1,
          autopositiontingValue: 1,
          "user.username": 1,
          "user.uhid": 1
        }
      }
    ]);

    if (!rows.length) {
      return res.status(200).end();
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Active LP");

    sheet.columns = [
      { header: "Username", key: "username", width: 24 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "LP", key: "lp", width: 16 },
      { header: "Autopositioning", key: "autopositionting", width: 20 },
      { header: "Active LP", key: "activeLp", width: 16 }
    ];

    let totalLp = 0;
    let totalAutopositionting = 0;
    let totalActiveLp = 0;

    rows.forEach((row) => {
      const lp = Number(row.lpValue || 0);
      const autopositioning = Number(row.autopositiontingValue || 0);
      const activeLp = Number(row.activeLp || 0);

      totalLp += lp;
      totalAutopositionting += autopositionting;
      totalActiveLp += activeLp;

      const sheetRow = sheet.addRow({
        username: row.user?.username || "Unknown",
        uhid: row.user?.uhid || "Unknown",
        lp,
        autopositioning,
        activeLp
      });

      sheetRow.eachCell((cell) => {
        if (typeof cell.value === "number") {
          cell.numFmt = "0.000000";
        }
      });
    });

    const totalRow = sheet.addRow({
      username: "TOTAL",
      lp: totalLp,
      autopositioning: totalAutopositionting,
      activeLp: totalActiveLp
    });
    totalRow.font = { bold: true };

    const fileName = `ActiveLP_Report_${new Date().toISOString().split("T")[0]}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${fileName}`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export Active LP Error:", err);
    res.status(500).json({
      message: "Failed to export Active LP data",
      error: err.message
    });
  }
};

exports.exportPositiveLP = async (req, res) => {
  try {
    const { search } = req.query;
    const ledgerQuery = { "wallets.lp": { $exists: true, $gt: 0 } };

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      if (matchedUsers.length > 0) ledgerQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const ledgers = await Ledger.find(ledgerQuery)
      .populate("userId", "username uhid")
      .lean();

    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);
    const autopositions = await LedgerRow.aggregate([
      { $match: { userId: { $in: userIds }, eventType: "AUTOPOSITIONING" } },
      {
        $group: {
          _id: "$userId",
          totalAuto: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const autoMap = {};
    autopositions.forEach((a) => (autoMap[a._id.toString()] = a.totalAuto));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Positive LP Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "LP", key: "lp", width: 15 },
      { header: "ZERO_RISK", key: "zeroRisk", width: 15 },
      { header: "AUTOPOSITIONING", key: "autopositioning", width: 20 },
    ];

    ledgers.forEach((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      sheet.addRow({
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        lp: Number(ledger.wallets.lp || 0).toFixed(6),
        zeroRisk: Number(ledger.wallets.zeroRisk || 0).toFixed(6),
        autopositioning: Number(autoMap[userIdStr] || 0).toFixed(6),
      });
    });

    const fileName = `PositiveLP_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (err) {
    console.error("Export Positive LP Error:", err);
    res.status(500).json({ message: "Failed to export Positive LP data", error: err.message });
  }
};


exports.get5xrewards = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const ledgerQuery = { "wallets.lp": { $exists: true, $gt: 0 } };

    // 🔍 Search by username or UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      const userIds = matchedUsers.map((u) => u._id);
      if (userIds.length === 0)
        return res.json({
          success: true,
          data: [],
          summary: { totalRecords: 0, totalLp: "0.000000", totalZeroRisk: "0.000000" },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });
      ledgerQuery.userId = { $in: userIds };
    }

    // 🧮 Summary Totals
    const [summary] = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalLp: { $sum: { $toDouble: "$wallets.lp" } },
          totalZeroRisk: { $sum: { $toDouble: "$wallets.zeroRisk" } },
        },
      },
    ]);

    const totalRecords = summary?.totalRecords || 0;
    const totalLp = summary?.totalLp || 0;
    const totalZeroRisk = summary?.totalZeroRisk || 0;

    // 🧾 Fetch data
    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.lp": -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 💰 Fetch autopositioning per user
    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);
    const autopositions = await LedgerRow.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          eventType: "AUTOPOSITIONING",
        },
      },
      {
        $group: {
          _id: "$userId",
          totalAuto: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const autoMap = {};
    autopositions.forEach((a) => (autoMap[a._id.toString()] = a.totalAuto));

    // 🧩 Final Data
    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        lp: Number(ledger.wallets.lp).toFixed(6),
        zeroRisk: Number(ledger.wallets.zeroRisk || 0).toFixed(6),
        autopositioning: (autoMap[userIdStr] || 0).toFixed(6),
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalLp: totalLp.toFixed(6),
        totalZeroRisk: totalZeroRisk.toFixed(6),
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Positive LP Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.export5xrewards = async (req, res) => {
  try {
    const { search } = req.query;
    const ledgerQuery = { "wallets.lp": { $exists: true, $gt: 0 } };

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      if (matchedUsers.length > 0) ledgerQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const ledgers = await Ledger.find(ledgerQuery)
      .populate("userId", "username uhid")
      .lean();

    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);
    const autopositions = await LedgerRow.aggregate([
      { $match: { userId: { $in: userIds }, eventType: "AUTOPOSITIONING" } },
      {
        $group: {
          _id: "$userId",
          totalAuto: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    const autoMap = {};
    autopositions.forEach((a) => (autoMap[a._id.toString()] = a.totalAuto));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Positive LP Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "LP", key: "lp", width: 15 },
      { header: "ZERO_RISK", key: "zeroRisk", width: 15 },
      { header: "AUTOPOSITIONING", key: "autopositioning", width: 20 },
    ];

    ledgers.forEach((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      sheet.addRow({
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        lp: Number(ledger.wallets.lp || 0).toFixed(6),
        zeroRisk: Number(ledger.wallets.zeroRisk || 0).toFixed(6),
        autopositioning: Number(autoMap[userIdStr] || 0).toFixed(6),
      });
    });

    const fileName = `PositiveLP_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (err) {
    console.error("Export Positive LP Error:", err);
    res.status(500).json({ message: "Failed to export Positive LP data", error: err.message });
  }
};

exports.getBooster = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const ledgerQuery = { "wallets.boost": { $exists: true, $gt: 0 } };

    // 🔍 Search by username or UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = matchedUsers.map((u) => u._id);
      if (userIds.length === 0)
        return res.json({
          success: true,
          data: [],
          summary: {
            totalRecords: 0,
            totalBoost: "0.000000",
            totalCap: "0.000000",
            totalUsed: "0.000000",
          },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });

      ledgerQuery.userId = { $in: userIds };
    }

    // 🧮 Summary Totals
    const [summary] = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalBoost: { $sum: { $toDouble: "$wallets.boost" } },
          totalCap: { $sum: { $toDouble: "$limits.boostLimit.cap" } },
          totalUsed: { $sum: { $toDouble: "$limits.boostLimit.used" } },
        },
      },
    ]);

    const totalRecords = summary?.totalRecords || 0;
    const totalBoost = summary?.totalBoost || 0;
    const totalCap = summary?.totalCap || 0;
    const totalUsed = summary?.totalUsed || 0;
    const totalpending = totalCap - totalUsed;

    // 🧾 Fetch data
    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.boost": -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 🧩 FINAL DATA MAP
    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        boost: Number(ledger.wallets.boost || 0).toFixed(6),
        cap: Number(ledger.limits?.boostLimit?.cap || 0).toFixed(6),
        used: Number(ledger.limits?.boostLimit?.used || 0).toFixed(6),
        pending: (
          Number(ledger.limits?.boostLimit?.cap || 0) -
          Number(ledger.limits?.boostLimit?.used || 0)
        ).toFixed(6),
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalBoost: totalBoost.toFixed(6),
        totalCap: totalCap.toFixed(6),
        totalUsed: totalUsed.toFixed(6),
        pending: totalpending.toFixed(6),
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Booster Report Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportBoosterrewards = async (req, res) => {
  try {
    const { search } = req.query;
    const ledgerQuery = { "wallets.boost": { $exists: true, $gt: 0 } };

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      if (matchedUsers.length > 0) ledgerQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const ledgers = await Ledger.find(ledgerQuery)
      .populate("userId", "username uhid")
      .lean();

    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);


    const autoMap = {};


    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Boost Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Boost", key: "boost", width: 15 },
      { header: "Boost Limit", key: "cap", width: 15 },
      { header: "Boost Used", key: "used", width: 20 },
    ];

    ledgers.forEach((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      sheet.addRow({
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        boost: Number(ledger.wallets.boost || 0).toFixed(6),
        cap: Number(ledger.limits.boostLimit.cap || 0).toFixed(6),
        used: Number(ledger.limits.boostLimit.used || 0).toFixed(6),
      });
    });

    const fileName = `Boost_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (err) {
    console.error("Export Positive LP Error:", err);
    res.status(500).json({ message: "Failed to export Positive LP data", error: err.message });
  }
};

exports.getDailyRewardsReport = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      date,
      fromDate,
      toDate,
      parent
    } = req.query;

    const skip = (page - 1) * limit;
    const moment = require("moment");

    /* =====================================================
     * DATE RANGE LOGIC (MATCHES exportDailyRewards)
     * ===================================================== */
    let todayStart, todayEnd, yesterdayStart, yesterdayEnd;

    if (fromDate && toDate) {
      const from = moment.utc(fromDate, "YYYY-MM-DD", true);
      const to = moment.utc(toDate, "YYYY-MM-DD", true);

      if (!from.isValid() || !to.isValid()) {
        return res.status(400).json({
          success: false,
          message: "Invalid fromDate / toDate format. Use YYYY-MM-DD"
        });
      }

      // TODAY → X1 / XPOWER
      todayStart = from.clone().startOf("day").toDate();
      todayEnd = to.clone().endOf("day").toDate();

      // YESTERDAY → LP / BOOST / AIRDROP / CASCADE / COMMUNITY
      yesterdayStart = from.clone().subtract(1, "day").startOf("day").toDate();
      yesterdayEnd = to.clone().subtract(1, "day").endOf("day").toDate();
    } else {
      const baseDate = date
        ? moment.utc(date, "YYYY-MM-DD", true)
        : moment.utc();

      if (date && !baseDate.isValid()) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use YYYY-MM-DD"
        });
      }

      todayStart = baseDate.clone().startOf("day").toDate();
      todayEnd = baseDate.clone().endOf("day").toDate();

      yesterdayStart = baseDate.clone().subtract(1, "day").startOf("day").toDate();
      yesterdayEnd = baseDate.clone().subtract(1, "day").endOf("day").toDate();
    }

    /* =====================================================
     * USER SEARCH
     * ===================================================== */
    let userMatch = {};
    if (search) {
      const users = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      const ids = users.map(u => u._id);
      if (!ids.length) {
        return res.json({
          success: true,
          data: [],
          summary: {},
          pagination: { totalItems: 0, totalPages: 0 }
        });
      }
      userMatch.userId = { $in: ids };
    }

    /* =====================================================
     * TEAM FILTER (PARENT + FULL DOWNLINE)
     * ===================================================== */
    let teamUserIdSet = null;

    if (parent) {
      const parentUser = await User.findOne({
        $or: [
          { username: { $regex: `^${parent}$`, $options: "i" } },
          { uhid: parent }
        ]
      }).select("uhid");

      if (!parentUser?.uhid) {
        return res.json({
          success: true,
          data: [],
          summary: {},
          pagination: { totalItems: 0, totalPages: 0 }
        });
      }

      const rootUhid = String(parentUser.uhid);
      const teamUhids = new Set([rootUhid]);
      const queue = [rootUhid];

      while (queue.length) {
        const current = queue.shift();
        const children = await Levels.find({ parent: current }).select("child");

        for (const row of children) {
          const childUhid = String(row.child);
          if (!teamUhids.has(childUhid)) {
            teamUhids.add(childUhid);
            queue.push(childUhid);
          }
        }
      }

      const teamUsers = await User.find({
        uhid: { $in: Array.from(teamUhids) }
      }).select("_id");

      teamUserIdSet = new Set(teamUsers.map(u => u._id.toString()));
    }

    /* =====================================================
     * AGGREGATIONS (UNCHANGED)
     * ===================================================== */
    const [
      x1Agg,
      xpowerAgg,
      ledgerAgg,
      cascadeAgg,
      boosterAgg
    ] = await Promise.all([

      X1Reward.aggregate([
        { $match: { ts: { $gte: todayStart, $lte: todayEnd }, ...userMatch } },
        { $group: { _id: "$userId", amount: { $sum: "$amount" } } }
      ]),

      LedgerRow.aggregate([
        {
          $match: {
            eventType: "XPOWER_REWARDS",
            ts: { $gte: todayStart, $lte: todayEnd },
            ...userMatch
          }
        },
        { $group: { _id: "$userId", amount: { $sum: "$amount" } } }
      ]),

      LedgerRow.aggregate([
        {
          $match: {
            eventType: {
              $in: [
                "DAILY_REWARDS_LP",
                "DAILY_REWARDS_BOOST",
                "DAILY_REWARDS_AIRDROP"
              ]
            },
            ts: { $gte: yesterdayStart, $lte: yesterdayEnd },
            ...userMatch
          }
        },
        {
          $group: {
            _id: { userId: "$userId", eventType: "$eventType" },
            amount: { $sum: "$amount" }
          }
        }
      ]),

      CascadeReward.aggregate([
        { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, ...userMatch } },
        { $group: { _id: "$userId", amount: { $sum: "$amount" } } }
      ]),

      CommunityBoosterReward.aggregate([
        { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, ...userMatch } },
        { $group: { _id: "$userId", amount: { $sum: "$amount" } } }
      ])
    ]);

    /* =====================================================
     * NORMALIZE + TEAM FILTER
     * ===================================================== */
    const rewardMap = {};
    const init = (uid) => {
      if (!rewardMap[uid]) {
        rewardMap[uid] = {
          x1Rewards: 0,
          xPowerRewards: 0,
          communityBoosterRewards: 0,
          dailyRewardsLp: 0,
          dailyRewardsAirdrop: 0,
          dailyRewardsBoost: 0,
          dailyCascadeRewards: 0,
          total: 0
        };
      }
    };

    x1Agg.forEach(r => {
      const id = r._id.toString();
      init(id);
      rewardMap[id].x1Rewards += parseFloat(r.amount);
    });

    xpowerAgg.forEach(r => {
      const id = r._id.toString();
      init(id);
      rewardMap[id].xPowerRewards += parseFloat(r.amount);
    });

    boosterAgg.forEach(r => {
      const id = r._id.toString();
      init(id);
      rewardMap[id].communityBoosterRewards += parseFloat(r.amount);
    });

    cascadeAgg.forEach(r => {
      const id = r._id.toString();
      init(id);
      rewardMap[id].dailyCascadeRewards += parseFloat(r.amount);
    });

    ledgerAgg.forEach(r => {
      const id = r._id.userId.toString();
      init(id);
      if (r._id.eventType === "DAILY_REWARDS_LP")
        rewardMap[id].dailyRewardsLp += parseFloat(r.amount);
      if (r._id.eventType === "DAILY_REWARDS_AIRDROP")
        rewardMap[id].dailyRewardsAirdrop += parseFloat(r.amount);
      if (r._id.eventType === "DAILY_REWARDS_BOOST")
        rewardMap[id].dailyRewardsBoost += parseFloat(r.amount);
    });

    let userIds = Object.keys(rewardMap);
    if (teamUserIdSet) {
      userIds = userIds.filter(uid => teamUserIdSet.has(uid));
    }

    /* =====================================================
     * BUILD ROWS + PAGINATION
     * ===================================================== */
    const totalRecords = userIds.length;
    const users = await User.find({ _id: { $in: userIds } })
      .select("username uhid")
      .lean();

    const userMap = {};
    users.forEach(u => (userMap[u._id.toString()] = u));

    const rows = userIds.map(uid => {
      const r = rewardMap[uid];
      r.total =
        r.x1Rewards +
        r.xPowerRewards +
        r.communityBoosterRewards +
        r.dailyRewardsLp +
        r.dailyRewardsAirdrop +
        r.dailyRewardsBoost +
        r.dailyCascadeRewards;

      return {
        username: userMap[uid]?.username || "Unknown",
        uhid: userMap[uid]?.uhid || "Unknown",
        ...Object.fromEntries(
          Object.entries(r).map(([k, v]) => [k, v.toFixed(6)])
        )
      };
    });

    const paginated = rows.slice(skip, skip + parseInt(limit));
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        limit: parseInt(limit)
      }
    });

  } catch (err) {
    console.error("Daily Rewards Users Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getDailyRewardTypeConfig = (rewardType, forExport) => {
  const listConfig = {
    x1Rewards: {
      label: "X Bonus",
      collection: X1Reward,
      dateField: "ts",
      range: "today"
    },
    xPowerRewards: {
      label: "XPower Rewards",
      collection: LedgerRow,
      dateField: "ts",
      range: "today",
      eventType: "XPOWER_REWARDS"
    },
    communityBoosterRewards: {
      label: "Community Booster",
      collection: CommunityBoosterReward,
      dateField: "createdAt",
      range: "yesterday"
    },
    dailyRewardsLp: {
      label: "LP Rewards",
      collection: LedgerRow,
      dateField: "ts",
      range: "yesterday",
      eventType: "DAILY_REWARDS_LP"
    },
    dailyRewardsAirdrop: {
      label: "Airdrop Rewards",
      collection: LedgerRow,
      dateField: "ts",
      range: "yesterday",
      eventType: "DAILY_REWARDS_AIRDROP"
    },
    dailyRewardsBoost: {
      label: "Boost Rewards",
      collection: LedgerRow,
      dateField: "ts",
      range: "yesterday",
      eventType: "DAILY_REWARDS_BOOST"
    },
    dailyCascadeRewards: {
      label: "Cascade Rewards",
      collection: CascadeReward,
      dateField: "createdAt",
      range: "yesterday"
    }
  };

  if (!forExport) return listConfig[rewardType];

  const exportConfig = {
    ...listConfig,
    xPowerRewards: {
      label: "XPower Rewards",
      collection: XPowerReward,
      dateField: "ts",
      range: "today"
    }
  };

  return exportConfig[rewardType];
};

const getDailyRewardsDateWindow = (date) => {
  const moment = require("moment");
  const baseDate = date
    ? moment.utc(date, "YYYY-MM-DD", true)
    : moment.utc();

  if (date && !baseDate.isValid()) {
    return { error: "Invalid date format. Use YYYY-MM-DD" };
  }

  return {
    baseDate,
    todayStart: baseDate.clone().startOf("day").toDate(),
    todayEnd: baseDate.clone().endOf("day").toDate(),
    yesterdayStart: baseDate.clone().subtract(1, "day").startOf("day").toDate(),
    yesterdayEnd: baseDate.clone().subtract(1, "day").endOf("day").toDate()
  };
};


exports.exportDailyRewards = async (req, res) => {
  try {
    const { search, date, fromDate, toDate, parent } = req.query;

    const ExcelJS = require("exceljs");
    const moment = require("moment");
    const mongoose = require("mongoose");

    const LedgerRow = require("../models/LedgerRow");
    const CascadeReward = require("../models/CascadeReward");
    const CommunityBoosterReward = require("../models/CommunityBoosterReward");
    const X1Reward = require("../models/X1Reward");
    const XPowerReward = require("../models/XPowerReward");
    const User = require("../models/User");
    const Levels = require("../models/Level");


    /* ---------------- DATE RANGE (UTC) ----------------
       IMPORTANT: keep your original semantics:
       - X1/XPower use "today" window
       - Ledger/Cascade/Booster use "yesterday" window
    --------------------------------------------------- */

    let todayStart, todayEnd, yesterdayStart, yesterdayEnd, fileNameLabel;

    if (fromDate && toDate) {
      const from = moment.utc(fromDate);
      const to = moment.utc(toDate);

      // "today" window for X1/XPower: from..to
      todayStart = from.clone().startOf("day").toDate();
      todayEnd = to.clone().endOf("day").toDate();

      // "yesterday" window for Ledger/Cascade/Booster: (from-1)..(to-1)
      yesterdayStart = from.clone().subtract(1, "day").startOf("day").toDate();
      yesterdayEnd = to.clone().subtract(1, "day").endOf("day").toDate();

      fileNameLabel = `${from.format("YYYY-MM-DD")}_to_${to.format("YYYY-MM-DD")}`;
    } else {
      const targetDate = date ? moment.utc(date) : moment.utc();

      todayStart = targetDate.clone().startOf("day").toDate();
      todayEnd = targetDate.clone().endOf("day").toDate();

      yesterdayStart = targetDate.clone().subtract(1, "day").startOf("day").toDate();
      yesterdayEnd = targetDate.clone().subtract(1, "day").endOf("day").toDate();

      fileNameLabel = targetDate.format("YYYY-MM-DD");
    }

    /* ---------------- SEARCH FILTER ---------------- */
    let allowedUserIds = null;

    if (search) {
      const users = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      if (!users.length) return res.status(200).end();
      allowedUserIds = users.map((u) => u._id.toString());
    }

    /* ---------------- TEAM FILTER (PARENT + FULL DOWNLINE) ----------------
       Levels schema you showed:
       { parent: "786000786", child:"174...", level:1, status:"1", timestamp:"..." }
       We will build full subtree by BFS over Levels edges.
    ---------------------------------------------------------------------- */
    let teamUserIdSet = null;

    if (parent) {
      const parentUser = await User.findOne({
        $or: [
          { username: { $regex: `^${parent}$`, $options: "i" } },
          { uhid: parent },
        ],
      }).select("uhid");

      if (!parentUser?.uhid) return res.status(200).end();

      const rootUhid = String(parentUser.uhid);

      const teamUhids = new Set([rootUhid]);
      const queue = [rootUhid];

      while (queue.length) {
        const currentParent = queue.shift();

        const childrenRows = await Levels.find({
          parent: currentParent,
        }).select("child");

        for (const row of childrenRows) {
          const childUhid = String(row.child);
          if (!teamUhids.has(childUhid)) {
            teamUhids.add(childUhid);
            queue.push(childUhid);
          }
        }
      }

      // ✅ THIS WAS MISSING
      const teamUsers = await User.find({
        uhid: { $in: Array.from(teamUhids) },
      }).select("_id");

      teamUserIdSet = new Set(
        teamUsers.map((u) => u._id.toString())
      );
    }

    if (teamUserIdSet) {
      
      
    }


    /* ---------------- COLLECT USER IDS (ALL SOURCES) ---------------- */
    const [x1Users, xpowerUsers, ledgerUsers, cascadeUsers, boosterUsers] =
      await Promise.all([
        X1Reward.distinct("userId", {
          ts: { $gte: todayStart, $lte: todayEnd },
        }),
        XPowerReward.distinct("userId", {
          ts: { $gte: todayStart, $lte: todayEnd },
        }),
        LedgerRow.distinct("userId", {
          eventType: {
            $in: ["DAILY_REWARDS_LP", "DAILY_REWARDS_AIRDROP", "DAILY_REWARDS_BOOST"],
          },
          ts: { $gte: yesterdayStart, $lte: yesterdayEnd },
        }),
        CascadeReward.distinct("userId", {
          createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
        }),
        CommunityBoosterReward.distinct("userId", {
          createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
        }),
      ]);

    let userIds = [
      ...x1Users,
      ...xpowerUsers,
      ...ledgerUsers,
      ...cascadeUsers,
      ...boosterUsers,
    ].map((u) => u.toString());

    userIds = [...new Set(userIds)];

    // Apply search filter (unchanged behavior)
    if (allowedUserIds) {
      userIds = userIds.filter((id) => allowedUserIds.includes(id));
    }

    // Apply team filter (parent + downline) AFTER reward collection (critical)
    if (teamUserIdSet) {
      userIds = userIds.filter((id) => teamUserIdSet.has(id));
    }

    if (!userIds.length) return res.status(200).end();

    const objectUserIds = userIds.map((id) => new mongoose.Types.ObjectId(id));

    /* ---------------- AGGREGATIONS (UNCHANGED LOGIC) ---------------- */
    const [x1Agg, xpowerAgg, ledgerAgg, cascadeAgg, boosterAgg] =
      await Promise.all([
        X1Reward.aggregate([
          {
            $match: {
              userId: { $in: objectUserIds },
              ts: { $gte: todayStart, $lte: todayEnd },
            },
          },
          { $group: { _id: "$userId", total: { $sum: "$amount" } } },
        ]),
        XPowerReward.aggregate([
          {
            $match: {
              userId: { $in: objectUserIds },
              ts: { $gte: todayStart, $lte: todayEnd },
            },
          },
          { $group: { _id: "$userId", total: { $sum: "$amount" } } },
        ]),
        LedgerRow.aggregate([
          {
            $match: {
              userId: { $in: objectUserIds },
              eventType: {
                $in: ["DAILY_REWARDS_LP", "DAILY_REWARDS_AIRDROP", "DAILY_REWARDS_BOOST"],
              },
              ts: { $gte: yesterdayStart, $lte: yesterdayEnd },
            },
          },
          {
            $group: {
              _id: { userId: "$userId", type: "$eventType" },
              total: { $sum: "$amount" },
            },
          },
        ]),
        CascadeReward.aggregate([
          {
            $match: {
              userId: { $in: objectUserIds },
              createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
            },
          },
          { $group: { _id: "$userId", total: { $sum: "$amount" } } },
        ]),
        CommunityBoosterReward.aggregate([
          {
            $match: {
              userId: { $in: objectUserIds },
              createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
            },
          },
          { $group: { _id: "$userId", total: { $sum: "$amount" } } },
        ]),
      ]);

    /* ---------------- MAP HELPERS ---------------- */
    const mapSimple = (arr) =>
      arr.reduce((a, r) => {
        a[r._id.toString()] = r.total;
        return a;
      }, {});

    const x1Map = mapSimple(x1Agg);
    const xpowerMap = mapSimple(xpowerAgg);
    const cascadeMap = mapSimple(cascadeAgg);
    const boosterMap = mapSimple(boosterAgg);

    const ledgerMap = {};
    ledgerAgg.forEach((r) => {
      const uid = r._id.userId.toString();
      if (!ledgerMap[uid]) ledgerMap[uid] = {};
      ledgerMap[uid][r._id.type] = r.total;
    });

    /* ---------------- USERS (WITH xRank) ---------------- */
    const users = await User.find({ _id: { $in: objectUserIds } })
      .select("username uhid xRank")
      .lean();

    /* ---------------- EXCEL ---------------- */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Daily Rewards", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Username", key: "username", width: 22 },
      { header: "UHID", key: "uhid", width: 18 },
      { header: "X Rank", key: "xRank", width: 10 },
      { header: "LP Rewards", key: "lp", width: 15 },
      { header: "Airdrop Rewards", key: "airdrop", width: 18 },
      { header: "Boost Rewards", key: "boost", width: 15 },
      { header: "Cascade Rewards", key: "cascade", width: 18 },
      { header: "Community Booster", key: "booster", width: 20 },
      { header: "X Bonus", key: "x1", width: 15 },
      { header: "XPower Rewards", key: "xpower", width: 18 },
      { header: "Total", key: "total", width: 18 },
    ];

    // Header style (same as your code)
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F3A8A" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    sheet.autoFilter = { from: "A1", to: "K1" };

    let totals = {
      lp: 0,
      airdrop: 0,
      boost: 0,
      cascade: 0,
      booster: 0,
      x1: 0,
      xpower: 0,
      grand: 0,
    };

    users.forEach((u) => {
      const uid = u._id.toString();

      const lp = Number(ledgerMap[uid]?.DAILY_REWARDS_LP || 0);
      const airdrop = Number(ledgerMap[uid]?.DAILY_REWARDS_AIRDROP || 0);
      const boost = Number(ledgerMap[uid]?.DAILY_REWARDS_BOOST || 0);
      const x1 = Number(x1Map[uid] || 0);
      const xpower = Number(xpowerMap[uid] || 0);
      const booster = Number(boosterMap[uid] || 0);
      const cascade = Number(cascadeMap[uid] || 0);

      const total = x1 + xpower + booster + lp + airdrop + boost + cascade;

      totals.lp += lp;
      totals.airdrop += airdrop;
      totals.boost += boost;
      totals.cascade += cascade;
      totals.booster += booster;
      totals.x1 += x1;
      totals.xpower += xpower;
      totals.grand += total;

      const row = sheet.addRow({
        username: u.username || "Unknown",
        uhid: u.uhid || "Unknown",
        xRank: u.xRank || "",
        lp,
        airdrop,
        boost,
        cascade,
        booster,
        x1,
        xpower,
        total,
      });

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        if (typeof cell.value === "number") cell.numFmt = "0.000000";
      });
    });

    const totalRow = sheet.addRow({
      username: "TOTAL",
      lp: totals.lp,
      airdrop: totals.airdrop,
      boost: totals.boost,
      cascade: totals.cascade,
      booster: totals.booster,
      x1: totals.x1,
      xpower: totals.xpower,
      total: totals.grand,
    });

    totalRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.border = {
        top: { style: "double" },
        left: { style: "thin" },
        bottom: { style: "double" },
        right: { style: "thin" },
      };
      if (colNumber >= 4) cell.numFmt = "0.000000";
    });

    const fileName = `Daily_Rewards_${fileNameLabel}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export Daily Rewards Error:", err);
    res.status(500).json({
      message: "Failed to export Daily Rewards",
      error: err.message,
    });
  }
};


exports.getDailyRewardsByType = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, date, parent } = req.query;
    const { type } = req.params;
    const skip = (page - 1) * limit;

    const allowedTypes = [
      "x1",
      "xpower",
      "booster",
      "lp",
      "airdrop-rewards",
      "boost",
      "community"
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rewardType",
        allowedTypes
      });
    }

    const rewardTypeMap = {
      x1: "x1Rewards",
      xpower: "xPowerRewards",
      booster: "communityBoosterRewards",
      lp: "dailyRewardsLp",
      "airdrop-rewards": "dailyRewardsAirdrop",
      boost: "dailyRewardsBoost",
      community: "dailyCascadeRewards"
    };

    const rewardType = rewardTypeMap[type];
    const config = getDailyRewardTypeConfig(rewardType, false);

    if (!config) {
      return res.status(400).json({
        success: false,
        message: "Invalid rewardType",
        allowedTypes
      });
    }

    const dateWindow = getDailyRewardsDateWindow(date);
    if (dateWindow.error) {
      return res.status(400).json({
        success: false,
        message: dateWindow.error
      });
    }

    const {
      baseDate,
      todayStart,
      todayEnd,
      yesterdayStart,
      yesterdayEnd
    } = dateWindow;

    const rangeStart =
      config.range === "today" ? todayStart : yesterdayStart;
    const rangeEnd =
      config.range === "today" ? todayEnd : yesterdayEnd;

    /* ================= SEARCH FILTER ================= */
    let userMatch = {};
    if (search) {
      const users = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      const ids = users.map(u => u._id);
      if (!ids.length) {
        return res.json({
          success: true,
          data: [],
          summary: {
            totalRecords: 0,
            totalRewards: "0.000000",
            ...(type === "boost" ? { totalAvailable: "0.000000" } : {}),
            rewardDate: baseDate.toISOString().slice(0, 10),
            rewardType: type
          },
          pagination: { totalItems: 0, totalPages: 0 }
        });
      }

      userMatch.userId = { $in: ids };
    }

    /* ================= PARENT / TEAM FILTER ================= */
    let teamUserIds = null;

    if (parent) {
      const parentUser = await User.findOne({ uhid: parent })
        .select("_id uhid")
        .lean();

      if (!parentUser) {
        return res.status(400).json({
          success: false,
          message: "Invalid parent"
        });
      }

      const levels = await Levels.find({ parent: parentUser.uhid })
        .select("child")
        .lean();

      const childUhids = levels.map(l => l.child);
      childUhids.push(parentUser.uhid);

      const teamUsers = await User.find({ uhid: { $in: childUhids } })
        .select("_id")
        .lean();

      teamUserIds = teamUsers.map(u => u._id);
    }

    /* ================= AGGREGATE REWARDS ================= */
    const match = {
      [config.dateField]: { $gte: rangeStart, $lte: rangeEnd },
      ...userMatch
    };

    if (teamUserIds) {
      match.userId = { $in: teamUserIds };
    }

    if (config.eventType) {
      match.eventType = config.eventType;
    }

    const agg = await config.collection.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$userId",
          amount: { $sum: "$amount" }
        }
      }
    ]);

    const rewardMap = {};
    agg.forEach(r => {
      rewardMap[r._id.toString()] = Number(r.amount);
    });

    const userIds = Object.keys(rewardMap);
    const totalRecords = userIds.length;

    /* ================= TOTAL AMOUNT (NON-LP/BOOST/AIRDROP) ================= */
    const totalCollectionByType = {
      x1: X1Reward,
      xpower: XPowerReward,
      booster: CommunityBoosterReward,
      community: CascadeReward
    };

    let totalAmountMap = {};
    const totalCollection = totalCollectionByType[type];

    if (totalCollection) {
      const objectUserIds = userIds.map(id => new mongoose.Types.ObjectId(id));
      const totalAgg = await totalCollection.aggregate([
        { $match: { userId: { $in: objectUserIds } } },
        { $group: { _id: "$userId", total: { $sum: "$amount" } } }
      ]);

      totalAgg.forEach(r => {
        totalAmountMap[r._id.toString()] = Number(r.total);
      });
    }

    if (!userIds.length) {
      return res.json({
        success: true,
        data: [],
        summary: {
          totalRecords: 0,
          totalRewards: "0.000000",
          ...(type === "boost" ? { totalAvailable: "0.000000" } : {}),
          rewardDate: baseDate.toISOString().slice(0, 10),
          rewardType: type
        },
        pagination: { totalItems: 0, totalPages: 0 }
      });
    }

    /* ================= FETCH USERS ================= */
    const users = await User.find({ _id: { $in: userIds } })
      .select("username uhid xRank")
      .lean();

    const userMap = {};
    users.forEach(u => {
      userMap[u._id.toString()] = u;
    });

    /* ================= LP SNAPSHOT (2 DAYS BEFORE) ================= */
    let lpSnapshotMap = {};

    if (type === "lp") {
      const twoDaysBefore = new Date(baseDate);
      twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);

      const startOfDay = new Date(twoDaysBefore);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(twoDaysBefore);
      endOfDay.setHours(23, 59, 59, 999);

      const lpSnapshots = await DailyUserLP.find({
        userId: { $in: userIds },
        date: { $gte: startOfDay, $lte: endOfDay }
      })
        .select("userId lp")
        .lean();

      lpSnapshots.forEach(d => {
        lpSnapshotMap[d.userId.toString()] = Number(d.lp || 0);
      });
    }

    /* ================= LP RATE + AUTOPOSITIONING ================= */
    let lpRateMap = {};
    let autopositioningMap = {};

    if (type === "lp") {
      const lpRates = await LPRewards.find({
        userId: { $in: userIds },
        createdAt: { $gte: rangeStart, $lte: rangeEnd }
      })
        .select("userId rate")
        .lean();

      lpRates.forEach(r => {
        lpRateMap[r.userId.toString()] = Number(r.rate || 0);
      });

      const ledgers = await Ledger.find({ userId: { $in: userIds } })
        .select("userId wallets.autopositionting")
        .lean();

      ledgers.forEach(l => {
        autopositioningMap[l.userId.toString()] = Number(
          l.wallets?.autopositionting || 0
        );
      });
    }

    /* ================= LIMITS (NON-LP) ================= */
    const limitFieldsByType = {
      x1: ["fiveXLimit"],
      xpower: ["fiveXLimit"],
      booster: ["fiveXLimit"],
      "airdrop-rewards": ["airdropLimit"],
      boost: ["boostLimit"],
      community: ["fiveXLimit", "lpLimit"]
    };

    const limitFields = limitFieldsByType[type] || [];
    let limitsMap = {};

    if (limitFields.length) {
      const fields = limitFields.map(f => `limits.${f}`).join(" ");
      const walletFields = type === "boost" ? "wallets.boost" : "";
      const ledgers = await Ledger.find({ userId: { $in: userIds } })
        .select(`userId ${fields} ${walletFields}`.trim())
        .lean();

      ledgers.forEach(l => {
        const entry = {};
        limitFields.forEach(f => {
          const limit = l.limits?.[f];
          entry[f] = {
            cap: toNumber(limit?.cap),
            used: toNumber(limit?.used)
          };
        });
        if (type === "boost") {
          entry.boostAvailable = toNumber(l.wallets?.boost);
        }
        limitsMap[l.userId.toString()] = entry;
      });
    }

    const totalRewards = userIds.reduce(
      (sum, uid) => sum + (rewardMap[uid] || 0),
      0
    );
    const totalAvailable =
      type === "boost"
        ? userIds.reduce(
          (sum, uid) => sum + (limitsMap[uid]?.boostAvailable || 0),
          0
        )
        : 0;

    /* ================= BUILD RESPONSE ROWS ================= */
    const rows = userIds.map(uid => {
      const row = {
        username: userMap[uid]?.username || "Unknown",
        uhid: userMap[uid]?.uhid || "Unknown",
        [rewardType]: rewardMap[uid].toFixed(6)
      };

      if (type === "lp") {
        const rewardsOnLP = lpSnapshotMap[uid] || 0;
        const autopositionting = autopositioningMap[uid] || 0;

        row.rewardsOnLP = rewardsOnLP.toFixed(6);
        row.rate = (lpRateMap[uid] || 0).toFixed(6);
        row.actualLPForRewards = Math.max(
          rewardsOnLP - autopositionting,
          0
        ).toFixed(6);
      }

      if (limitFields.length) {
        const mainLimit = limitsMap[uid]?.[limitFields[0]];
        row.cap = (mainLimit?.cap || 0).toFixed(6);
        row.used = (mainLimit?.used || 0).toFixed(6);
      }

      if (type === "community") {
        const lpLimit = limitsMap[uid]?.lpLimit;
        row.lpCap = (lpLimit?.cap || 0).toFixed(6);
        row.lpUsed = (lpLimit?.used || 0).toFixed(6);
      }

      if (type === "xpower") {
        row.xRank = userMap[uid]?.xRank || "";
      }

      if (type === "boost") {
        row.available = (limitsMap[uid]?.boostAvailable || 0).toFixed(6);
      }

      if (totalCollection) {
        row.total = (totalAmountMap[uid] || 0).toFixed(6);
      }

      return row;
    });

    /* ================= PAGINATION ================= */
    const paginated = rows.slice(skip, skip + parseInt(limit));
    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data: paginated,
      summary: {
        totalRecords,
        totalRewards: totalRewards.toFixed(6),
        ...(type === "boost" ? { totalAvailable: totalAvailable.toFixed(6) } : {}),
        rewardDate: baseDate.toISOString().slice(0, 10),
        rewardType: type
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        limit: parseInt(limit)
      }
    });
  } catch (err) {
    console.error("Daily Rewards By Type Error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



exports.exportDailyRewardsByType = async (req, res) => {
  try {
    const { search, date, parent } = req.query;
    const { type } = req.params;

    const allowedTypes = [
      "x1",
      "xpower",
      "booster",
      "lp",
      "airdrop-rewards",
      "boost",
      "community"
    ];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        message: "Invalid rewardType",
        allowedTypes
      });
    }

    const rewardTypeMap = {
      x1: "x1Rewards",
      xpower: "xPowerRewards",
      booster: "communityBoosterRewards",
      lp: "dailyRewardsLp",
      "airdrop-rewards": "dailyRewardsAirdrop",
      boost: "dailyRewardsBoost",
      community: "dailyCascadeRewards"
    };

    const rewardType = rewardTypeMap[type];
    const config = getDailyRewardTypeConfig(rewardType, true);
    if (!config) {
      return res.status(400).json({
        message: "Invalid rewardType",
        allowedTypes
      });
    }

    const dateWindow = getDailyRewardsDateWindow(date);
    if (dateWindow.error) {
      return res.status(400).json({ message: dateWindow.error });
    }

    const { baseDate, todayStart, todayEnd, yesterdayStart, yesterdayEnd } =
      dateWindow;

    const rangeStart =
      config.range === "today" ? todayStart : yesterdayStart;
    const rangeEnd = config.range === "today" ? todayEnd : yesterdayEnd;

    let allowedUserIds = null;

    /* ================= SEARCH FILTER ================= */
    if (search) {
      const users = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      if (!users.length) {
        return res.status(200).end();
      }

      allowedUserIds = users.map(u => u._id.toString());
    }

    /* ================= PARENT / TEAM FILTER ================= */
    let teamUserIds = null;

    if (parent) {
      const parentUser = await User.findOne({ uhid: parent })
        .select("_id uhid")
        .lean();

      if (!parentUser) {
        return res.status(400).json({ message: "Invalid parent" });
      }

      const levels = await Levels.find({ parent: parentUser.uhid })
        .select("child")
        .lean();

      const childUhids = levels.map(l => l.child);
      childUhids.push(parentUser.uhid);

      const teamUsers = await User.find({ uhid: { $in: childUhids } })
        .select("_id")
        .lean();

      teamUserIds = teamUsers.map(u => u._id.toString());
    }

    /* ================= DISTINCT USER IDS ================= */
    const distinctMatch = {
      [config.dateField]: { $gte: rangeStart, $lte: rangeEnd }
    };
    if (config.eventType) distinctMatch.eventType = config.eventType;

    let userIds = await config.collection.distinct("userId", distinctMatch);
    userIds = userIds.map(u => u.toString());

    if (allowedUserIds) {
      userIds = userIds.filter(id => allowedUserIds.includes(id));
    }

    if (teamUserIds) {
      userIds = userIds.filter(id => teamUserIds.includes(id));
    }

    if (!userIds.length) {
      return res.status(200).end();
    }

    const objectUserIds = userIds.map(
      id => new mongoose.Types.ObjectId(id)
    );

    /* ================= AGGREGATE ================= */
    const aggMatch = {
      userId: { $in: objectUserIds },
      [config.dateField]: { $gte: rangeStart, $lte: rangeEnd }
    };
    if (config.eventType) aggMatch.eventType = config.eventType;

    const agg = await config.collection.aggregate([
      { $match: aggMatch },
      { $group: { _id: "$userId", total: { $sum: "$amount" } } }
    ]);

    const rewardMap = agg.reduce((acc, r) => {
      acc[r._id.toString()] = parseFloat(r.total.toString());
      return acc;
    }, {});

    /* ================= TOTAL AMOUNT (NON-LP/BOOST/AIRDROP) ================= */
    const totalCollectionByType = {
      x1: X1Reward,
      xpower: XPowerReward,
      booster: CommunityBoosterReward,
      community: CascadeReward
    };

    let totalAmountMap = {};
    const totalCollection = totalCollectionByType[type];

    if (totalCollection) {
      const totalAgg = await totalCollection.aggregate([
        { $match: { userId: { $in: objectUserIds } } },
        { $group: { _id: "$userId", total: { $sum: "$amount" } } }
      ]);

      totalAgg.forEach(r => {
        totalAmountMap[r._id.toString()] = Number(r.total);
      });
    }

    /* ================= USERS ================= */
    const users = await User.find({ _id: { $in: objectUserIds } })
      .select("username uhid xRank")
      .lean();

    /* ================= LP EXTRA DATA ================= */
    let lpRateMap = {};
    let autopositioningMap = {};
    let lpSnapshotMap = {};

    if (type === "lp") {
      /* LP snapshot (2 days before) */
      const twoDaysBefore = new Date(baseDate);
      twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);

      const startOfDay = new Date(twoDaysBefore);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(twoDaysBefore);
      endOfDay.setHours(23, 59, 59, 999);

      const lpSnapshots = await DailyUserLP.find({
        userId: { $in: objectUserIds },
        date: { $gte: startOfDay, $lte: endOfDay }
      })
        .select("userId lp")
        .lean();

      lpSnapshots.forEach(d => {
        lpSnapshotMap[d.userId.toString()] = Number(d.lp || 0);
      });

      /* LP rate */
      const lpRates = await LPRewards.find({
        userId: { $in: objectUserIds },
        createdAt: { $gte: rangeStart, $lte: rangeEnd }
      })
        .select("userId rate")
        .lean();

      lpRates.forEach(r => {
        lpRateMap[r.userId.toString()] = r.rate
          ? Number(r.rate.toString())
          : 0;
      });

      /* Autopositioning */
      const ledgers = await Ledger.find({ userId: { $in: objectUserIds } })
        .select("userId wallets.autopositionting")
        .lean();

      ledgers.forEach(l => {
        autopositioningMap[l.userId.toString()] = Number(
          l.wallets?.autopositionting || 0
        );
      });
    }

    /* ================= LIMITS (NON-LP) ================= */
    const limitFieldsByType = {
      x1: ["fiveXLimit"],
      xpower: ["fiveXLimit"],
      booster: ["fiveXLimit"],
      "airdrop-rewards": ["airdropLimit"],
      boost: ["boostLimit"],
      community: ["fiveXLimit", "lpLimit"]
    };

    const limitFields = limitFieldsByType[type] || [];
    let limitsMap = {};

    if (limitFields.length) {
      const fields = limitFields.map(f => `limits.${f}`).join(" ");
      const walletFields = type === "boost" ? "wallets.boost" : "";
      const ledgers = await Ledger.find({ userId: { $in: objectUserIds } })
        .select(`userId ${fields} ${walletFields}`.trim())
        .lean();

      ledgers.forEach(l => {
        const entry = {};
        limitFields.forEach(f => {
          const limit = l.limits?.[f];
          entry[f] = {
            cap: toNumber(limit?.cap),
            used: toNumber(limit?.used)
          };
        });
        if (type === "boost") {
          entry.boostAvailable = toNumber(l.wallets?.boost);
        }
        limitsMap[l.userId.toString()] = entry;
      });
    }

    /* ================= EXCEL ================= */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(config.label, {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    if (type === "lp") {
      sheet.columns = [
        { header: "Username", key: "username", width: 22 },
        { header: "UHID", key: "uhid", width: 18 },
        { header: "X Rank", key: "xRank", width: 10 },
        { header: config.label, key: "reward", width: 18 },
        { header: "Rewards On LP", key: "rewardsOnLP", width: 18 },
        { header: "Rate", key: "rate", width: 12 },
        { header: "Actual LP For Rewards", key: "actualLPForRewards", width: 22 }
      ];
    } else {
      const columns = [
        { header: "Username", key: "username", width: 22 },
        { header: "UHID", key: "uhid", width: 18 }
      ];

      if (type === "xpower") {
        columns.push({ header: "X Rank", key: "xRank", width: 10 });
      }

      columns.push({ header: config.label, key: "reward", width: 18 });

      if (totalCollection) {
        columns.push({ header: "Total Amount", key: "totalAmount", width: 18 });
      }

      if (limitFields.length) {
        columns.push({ header: "Cap", key: "cap", width: 16 });
        columns.push({ header: "Used", key: "used", width: 16 });
      }

      if (type === "community") {
        columns.push({ header: "LP Cap", key: "lpCap", width: 16 });
        columns.push({ header: "LP Used", key: "lpUsed", width: 16 });
      }

      if (type === "boost") {
        columns.push({ header: "Available", key: "available", width: 16 });
      }

      sheet.columns = columns;
    }

    let total = 0;
    let totalAvailable = 0;

    users.forEach(u => {
      const uid = u._id.toString();
      const reward = Number(rewardMap[uid] || 0);
      total += reward;

      const rowData = {
        username: u.username || "Unknown",
        uhid: u.uhid || "Unknown",
        reward
      };

      if (totalCollection) {
        rowData.total = totalAmountMap[uid] || 0;
      }

      if (type === "xpower") {
        rowData.xRank = u.xRank || "";
      }

      if (type === "lp") {
        const rewardsOnLP = lpSnapshotMap[uid] || 0;
        const autopositionting = autopositioningMap[uid] || 0;

        rowData.rewardsOnLP = rewardsOnLP;
        rowData.rate = lpRateMap[uid] || 0;
        rowData.actualLPForRewards = Math.max(
          rewardsOnLP - autopositionting,
          0
        );
      } else if (limitFields.length) {
        const mainLimit = limitsMap[uid]?.[limitFields[0]];
        rowData.cap = mainLimit?.cap || 0;
        rowData.used = mainLimit?.used || 0;

        if (type === "community") {
          const lpLimit = limitsMap[uid]?.lpLimit;
          rowData.lpCap = lpLimit?.cap || 0;
          rowData.lpUsed = lpLimit?.used || 0;
        }

        if (type === "boost") {
          rowData.available = limitsMap[uid]?.boostAvailable || 0;
          totalAvailable += rowData.available;
        }
      }

      const row = sheet.addRow(rowData);

      row.eachCell(cell => {
        if (typeof cell.value === "number") {
          cell.numFmt = "0.000000";
        }
      });
    });

    const totalRow = sheet.addRow({
      username: "TOTAL",
      reward: total,
      ...(type === "boost" ? { available: totalAvailable } : {})
    });
    totalRow.font = { bold: true };

    const fileName = `${type}_${baseDate.format("YYYY-MM-DD")}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export Daily Rewards By Type Error:", err);
    res.status(500).json({
      message: "Failed to export Daily Rewards by type",
      error: err.message
    });
  }
};



exports.getUsdt = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const ledgerQuery = { "wallets.bnb": { $exists: true, $gt: 0 } };

    // 🔍 Search by username or UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = matchedUsers.map((u) => u._id);

      if (userIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          summary: {
            totalRecords: 0,
            totalUsdt: "0.000000",
          },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });
      }

      ledgerQuery.userId = { $in: userIds };
    }

    // 🧮 Summary Totals
    const summaryQuery = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalUsdt: { $sum: { $toDouble: "$wallets.bnb" } }
        },
      },
    ]);

    const totalRecords = summaryQuery?.[0]?.totalRecords || 0;
    const totalUsdt = summaryQuery?.[0]?.totalUsdt || 0;

    // 🧾 Fetch paginated data
    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.bnb": -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate("userId", "username uhid")
      .lean();

    // 🧩 FINAL DATA MAP
    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        usdt: Number(ledger.wallets.bnb || 0).toFixed(6),
      };
    });

    const totalPages = Math.ceil(totalRecords / limitNumber);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalUsdt: totalUsdt.toFixed(6), // fixed
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: pageNumber,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
        limit: limitNumber,
      },
    });

  } catch (err) {
    console.error("❌ Usdt Report Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.exportUsdt = async (req, res) => {
  try {
    const { search } = req.query;

    // Query only users having Usdt wallet balance
    const ledgerQuery = { "wallets.bnb": { $exists: true, $gt: 0 } };

    // 🔍 Search by username / UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      if (matchedUsers.length > 0) {
        ledgerQuery.userId = { $in: matchedUsers.map((u) => u._id) };
      }
    }

    // Fetch all records
    const ledgers = await Ledger.find(ledgerQuery)
      .populate("userId", "username uhid")
      .lean();

    // Create Excel Sheet
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Usdt Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Usdt Balance", key: "usdt", width: 20 },
    ];

    // Add rows
    ledgers.forEach((ledger) => {
      const user = ledger.userId || {};

      sheet.addRow({
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        usdt: Number(ledger.wallets.bnb || 0).toFixed(6),
      });
    });

    const fileName = `Usdt_Report_${new Date().toISOString().split("T")[0]}.xlsx`;

    // Send Excel File to Client
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${fileName}`
    );

    await workbook.xlsx.write(res);
    res.status(200).end();

  } catch (err) {
    console.error("Export Usdt Error:", err);
    res.status(500).json({
      message: "Failed to export Usdt data",
      error: err.message,
    });
  }
};

exports.getAutopositioningWallet = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    const ledgerQuery = {
      "wallets.autopositionting": { $exists: true, $gt: 0 }
    };

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } }
        ]
      }).select("_id");

      const userIds = matchedUsers.map((u) => u._id);
      if (userIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          summary: {
            totalRecords: 0,
            totalAutopositionting: "0.000000"
          },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
            limit: limitNumber
          }
        });
      }

      ledgerQuery.userId = { $in: userIds };
    }

    const [summary] = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalAutopositionting: {
            $sum: { $toDouble: "$wallets.autopositionting" }
          }
        }
      }
    ]);

    const totalRecords = summary?.totalRecords || 0;
    const totalAutopositionting = summary?.totalAutopositionting || 0;

    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.autopositionting": -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate("userId", "username uhid")
      .lean();

    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        autopositionting: Number(ledger.wallets.autopositionting || 0).toFixed(6)
      };
    });

    const totalPages = Math.ceil(totalRecords / limitNumber);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalAutopositionting: totalAutopositionting.toFixed(6)
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: pageNumber,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
        limit: limitNumber
      }
    });
  } catch (err) {
    console.error("Autopositionting Wallet Report Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getOnChainDepositWithdrawalRows = async () => {
  const [
    depositTotals,
    withdrawalTotals,
    latestDeposits,
    latestWithdrawals
  ] = await Promise.all([
    ChainDeposit.aggregate([
      { $group: { _id: "$userId", total: { $sum: "$amount" } } }
    ]),
    ChainWithdrawal.aggregate([
      { $group: { _id: "$userId", total: { $sum: "$amount" } } }
    ]),
    ChainDeposit.aggregate([
      { $sort: { txDate: -1 } },
      {
        $group: {
          _id: "$userId",
          latestAmount: { $first: "$amount" },
          latestDate: { $first: "$txDate" }
        }
      }
    ]),
    ChainWithdrawal.aggregate([
      { $sort: { txDate: -1 } },
      {
        $group: {
          _id: "$userId",
          latestAmount: { $first: "$amount" },
          latestDate: { $first: "$txDate" }
        }
      }
    ])
  ]);

  const depositTotalMap = Object.fromEntries(
    depositTotals.map((d) => [d._id.toString(), Number(d.total || 0)])
  );
  const withdrawalTotalMap = Object.fromEntries(
    withdrawalTotals.map((w) => [w._id.toString(), Number(w.total || 0)])
  );
  const latestDepositMap = Object.fromEntries(
    latestDeposits.map((d) => [
      d._id.toString(),
      { amount: Number(d.latestAmount || 0), date: d.latestDate || null }
    ])
  );
  const latestWithdrawalMap = Object.fromEntries(
    latestWithdrawals.map((w) => [
      w._id.toString(),
      { amount: Number(w.latestAmount || 0), date: w.latestDate || null }
    ])
  );

  const userIds = new Set([
    ...Object.keys(depositTotalMap),
    ...Object.keys(withdrawalTotalMap),
    ...Object.keys(latestDepositMap),
    ...Object.keys(latestWithdrawalMap)
  ]);

  const users = await User.find({ _id: { $in: Array.from(userIds) } })
    .select("username uhid")
    .lean();
  const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

  return Array.from(userIds).map((id) => {
    const latestDeposit = latestDepositMap[id] || { amount: 0, date: null };
    const latestWithdrawal = latestWithdrawalMap[id] || { amount: 0, date: null };

    return {
      userId: id,
      username: userMap[id]?.username || "Unknown",
      uhid: userMap[id]?.uhid || "Unknown",
      allTimeDeposit: depositTotalMap[id] || 0,
      allTimeWithdrawal: withdrawalTotalMap[id] || 0,
      latestDepositAmount: latestDeposit.amount,
      latestDepositDate: latestDeposit.date,
      latestWithdrawalAmount: latestWithdrawal.amount,
      latestWithdrawalDate: latestWithdrawal.date
    };
  });
};

exports.getOnChainWithdrawalsGreaterThanDeposits = async (req, res) => {
  try {
    const rows = await getOnChainDepositWithdrawalRows();
    const data = rows.filter((r) => r.allTimeWithdrawal > r.allTimeDeposit);

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error("On-chain Withdrawal > Deposit Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOnChainDepositsGreaterThanWithdrawals = async (req, res) => {
  try {
    const rows = await getOnChainDepositWithdrawalRows();
    const data = rows.filter((r) => r.allTimeDeposit > r.allTimeWithdrawal);

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (err) {
    console.error("On-chain Deposit > Withdrawal Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAirdrop = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const ledgerQuery = { "wallets.airdrop": { $exists: true, $gt: 0 } };

    // 🔍 Search by username or UHID
    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const userIds = matchedUsers.map((u) => u._id);
      if (userIds.length === 0)
        return res.json({
          success: true,
          data: [],
          summary: {
            totalRecords: 0,
            totalBoost: "0.000000",
            totalCap: "0.000000",
            totalUsed: "0.000000",
          },
          pagination: {
            totalItems: 0,
            currentPage: 1,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });

      ledgerQuery.userId = { $in: userIds };
    }

    // 🧮 Summary Totals
    const [summary] = await Ledger.aggregate([
      { $match: ledgerQuery },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalAirdrop: { $sum: { $toDouble: "$wallets.airdrop" } },
          totalCap: { $sum: { $toDouble: "$limits.airdropLimit.cap" } },
          totalUsed: { $sum: { $toDouble: "$limits.airdropLimit.used" } },
        },
      },
    ]);

    const totalRecords = summary?.totalRecords || 0;
    const totalAirdrop = summary?.totalAirdrop || 0;
    const totalCap = summary?.totalCap || 0;
    const totalUsed = summary?.totalUsed || 0;
    const totalpending = totalCap - totalUsed;

    // 🧾 Fetch data
    const ledgers = await Ledger.find(ledgerQuery)
      .sort({ "wallets.airdrop": -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "username uhid")
      .lean();

    // 🧩 FINAL DATA MAP
    const data = ledgers.map((ledger) => {
      const user = ledger.userId || {};
      return {
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        airdrop: Number(ledger.wallets.airdrop || 0).toFixed(6),
        cap: Number(ledger.limits?.airdropLimit?.cap || 0).toFixed(6),
        used: Number(ledger.limits?.airdropLimit?.used || 0).toFixed(6),
        pending: (
          Number(ledger.limits?.airdropLimit?.cap || 0) -
          Number(ledger.limits?.airdropLimit?.used || 0)
        ).toFixed(6),
      };
    });

    const totalPages = Math.ceil(totalRecords / limit);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        totalRecords,
        totalAirdrop: totalAirdrop.toFixed(6),
        totalCap: totalCap.toFixed(6),
        totalUsed: totalUsed.toFixed(6),
        pending: totalpending.toFixed(6),
      },
      pagination: {
        totalItems: totalRecords,
        currentPage: parseInt(page),
        totalPages,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Airdrop  Report Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.exportAirdroprewards = async (req, res) => {
  try {
    const { search } = req.query;
    const ledgerQuery = { "wallets.airdrop": { $exists: true, $gt: 0 } };

    if (search) {
      const matchedUsers = await User.find({
        $or: [
          { username: { $regex: search, $options: "i" } },
          { uhid: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      if (matchedUsers.length > 0) ledgerQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const ledgers = await Ledger.find(ledgerQuery)
      .populate("userId", "username uhid")
      .lean();

    const userIds = ledgers.map((l) => l.userId?._id).filter(Boolean);


    const autoMap = {};


    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Airdrop Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Airdrop", key: "airdrop", width: 15 },
      { header: "Airdrop Limit", key: "cap", width: 15 },
      { header: "Airdrop Used", key: "used", width: 20 },
    ];

    ledgers.forEach((ledger) => {
      const user = ledger.userId || {};
      const userIdStr = user._id?.toString();
      sheet.addRow({
        username: user.username || "Unknown",
        uhid: user.uhid || "Unknown",
        airdrop: Number(ledger.wallets.airdrop || 0).toFixed(6),
        cap: Number(ledger.limits.airdropLimit.cap || 0).toFixed(6),
        used: Number(ledger.limits.airdropLimit.used || 0).toFixed(6),
      });
    });

    const fileName = `Airdrop_Report_${new Date().toISOString().split("T")[0]}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

    await workbook.xlsx.write(res);
    res.status(200).end();
  } catch (err) {
    console.error("Export Airdrop Error:", err);
    res.status(500).json({ message: "Failed to export Airdrop data", error: err.message });
  }
};

// GET /api/support/system-report
// exports.getSystemReport = async (req, res) => {
//   try {
//     /* --------------------------------------------------------------
//      * Aggregate totals from Ledger collection
//      * ------------------------------------------------------------*/
//     const [ledgerTotals] = await Ledger.aggregate([
//       {
//         $group: {
//           _id: null,
//           totalPositiveLP: {
//             $sum: {
//               $cond: [{ $gt: ["$wallets.lp", 0] }, "$wallets.lp", 0],
//             },
//           },
//           totalNegativeLP: {
//             $sum: {
//               $cond: [{ $lt: ["$wallets.lp", 0] }, "$wallets.lp", 0],
//             },
//           },
//           total5xUsed: { $sum: "$limits.fiveXLimit.used" },
//           totalCascadeRewards: { $sum: "$wallets.cascadeRewards" },
//           // New wallet totals
//           totalAirdropWallet: { $sum: "$wallets.airdrop" },
//           totalBoosterWallet: { $sum: "$wallets.boost" },
//           totalLPWallet: { $sum: "$wallets.lp" },
//           totalZeroRiskWallet: { $sum: "$wallets.zeroRisk" },
//           totalUsdtWallet: { $sum: "$wallets.bnb" },
//           // Community Rewards wallet total
//           totalCommunityRewardsWallet: { $sum: "$wallets.communityRewards" },
//         },
//       },
//     ]);
//     // Count distinct users whose usdt > 0.0
//     const [{ userCountusdt = 0 } = {}] = await Ledger.aggregate([
//       {
//         $match: {
//           "wallets.bnb": { $gt: mongoose.Types.Decimal128.fromString("0.0") },
//         },
//       },
//       { $group: { _id: "$userId" } },
//       { $count: "userCountusdt" },
//     ]);

//     // Count distinct users whose zeroRisk > 0.0
//     const [{ userCountzeroRisk = 0 } = {}] = await Ledger.aggregate([
//       {
//         $match: {
//           "wallets.zeroRisk": {
//             $gt: mongoose.Types.Decimal128.fromString("0.0"),
//           },
//         },
//       },
//       { $group: { _id: "$userId" } },
//       { $count: "userCountzeroRisk" },
//     ]);

//     // Count distinct users whose communityRewards > 0.0
//     const [{ userCountcommunityRewards = 0 } = {}] = await Ledger.aggregate([
//       {
//         $match: {
//           "wallets.communityRewards": {
//             $gt: mongoose.Types.Decimal128.fromString("0.0"),
//           },
//         },
//       },
//       { $group: { _id: "$userId" } },
//       { $count: "userCountcommunityRewards" },
//     ]);

//     /* --------------------------------------------------------------
//      * Totals from other collections
//      * ------------------------------------------------------------*/
//  const [result] = await X1Reward.aggregate([
//   {
//     $facet: {
//       totalRewards: [
//         { $group: { _id: null, total: { $sum: "$amount" } } }
//       ],
//       distinctUsers: [
//         { $group: { _id: "$userId" } },
//         { $count: "userCount" }
//       ]
//     }
//   }
// ]);
// const x1RewardsTotal =
//   result.totalRewards[0]?.total || mongoose.Types.Decimal128.fromString("0.0");
// const X1RewarduserCount = result.distinctUsers[0]?.userCount || 0;

//     const [
//       {
//         total: boosterRewardsTotal = mongoose.Types.Decimal128.fromString(
//           "0.0"
//         ),
//       } = {},
//     ] = await CommunityBoosterReward.aggregate([
//       { $group: { _id: null, total: { $sum: "$amount" } } },
//     ]);

//     /* --------------------------------------------------------------
//      * On-chain deposits & withdrawals totals
//      * ------------------------------------------------------------*/
//     const [{ total: onChainDeposits = 0 } = {}] = await ChainDeposit.aggregate([
//       { $group: { _id: null, total: { $sum: "$amount" } } },
//     ]);

//     const [{ total: onChainWithdrawals = 0 } = {}] =
//       await ChainWithdrawal.aggregate([
//         { $group: { _id: null, total: { $sum: "$amount" } } },
//       ]);

//     /* --------------------------------------------------------------
//      * Lifetime distributed reward totals (LedgerRow)
//      * ------------------------------------------------------------*/
//     const rewardAgg = await LedgerRow.aggregate([
//       {
//         $match: {
//           eventType: {
//             $in: [
//               "DAILY_REWARDS_LP",
//               "DAILY_REWARDS_AIRDROP",
//               "DAILY_REWARDS_BOOST",
//             ],
//           },
//         },
//       },
//       { $group: { _id: "$eventType", total: { $sum: "$amount" } } },
//     ]);

//     const rewardMap = rewardAgg.reduce((acc, cur) => {
//       acc[cur._id] = cur.total;
//       return acc;
//     }, {});

//     const distributedLpRewards =
//       rewardMap["DAILY_REWARDS_LP"] ||
//       mongoose.Types.Decimal128.fromString("0.0");
//     const distributedAirdropRewards =
//       rewardMap["DAILY_REWARDS_AIRDROP"] ||
//       mongoose.Types.Decimal128.fromString("0.0");
//     const distributedBoosterRewards =
//       rewardMap["DAILY_REWARDS_BOOST"] ||
//       mongoose.Types.Decimal128.fromString("0.0");

//     /* --------------------------------------------------------------
//      * Daily Cascade Rewards (wallets.dailyCascadeRewards)
//      * ------------------------------------------------------------*/
// // Yesterday UTC start & end
// const cascadeYStart = new Date();
// cascadeYStart.setUTCDate(cascadeYStart.getUTCDate() - 1);
// cascadeYStart.setUTCHours(0, 0, 0, 0);

// const cascadeYEnd = new Date();
// cascadeYEnd.setUTCDate(cascadeYEnd.getUTCDate() - 1);
// cascadeYEnd.setUTCHours(23, 59, 59, 999);

// // Fetch cascade rewards for yesterday
// const [cascadeYesterdayAgg = {}] = await CascadeReward.aggregate([
//   {
//     $match: {
//       createdAt: { $gte: cascadeYStart, $lte: cascadeYEnd }
//     }
//   },
//   {
//     $group: {
//       _id: null,
//       total: { $sum: "$amount" }
//     }
//   }
// ]);

// const dailyCascadeTotal = cascadeYesterdayAgg.total
//   ? cascadeYesterdayAgg.total
//   : mongoose.Types.Decimal128.fromString("0.0");

//    /* --------------------------------------------------------------
//  * Last daily rewards distribution (LedgerRows)
//  * ------------------------------------------------------------*/
// const lastDistribution = await LedgerRow.findOne({
//   eventType: {
//     $in: [
//       "DAILY_REWARDS_LP",
//       "DAILY_REWARDS_AIRDROP",
//       "DAILY_REWARDS_BOOST",
//     ],
//   },
// })
//   .sort({ ts: -1 })
//   .lean();

// // Daily Rewards object with defaults
// let dailyRewards = {
//   date: null,
//   x1Rewards: "0.0",
//   communityBoosterRewards: "0.0",
//   dailyRewardsLp: "0.0",
//   dailyRewardsAirdrop: "0.0",
//   dailyRewardsBoost: "0.0",
//   dailyCascadeRewards: dailyCascadeTotal.toString(),
//   total: dailyCascadeTotal.toString(),
// };

// /* --------------------------------------------------------------
//  * FIXED: X1Rewards & BoosterRewards ALWAYS calculated for TODAY
//  * ------------------------------------------------------------*/
// const todayStart = new Date();
// todayStart.setUTCHours(0, 0, 0, 0);
// const todayEnd = new Date();
// todayEnd.setUTCHours(23, 59, 59, 999);

// // X1 Rewards today
// const [x1TodayAgg = {}] = await X1Reward.aggregate([
//   { $match: { ts: { $gte: todayStart, $lte: todayEnd } } },
//   { $group: { _id: null, total: { $sum: "$amount" } } },
// ]);

// const x1Today = x1TodayAgg.total
//   ? x1TodayAgg.total
//   : mongoose.Types.Decimal128.fromString("0.0");
// // Yesterday UTC range
// const yesterdayStart = new Date();
// yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
// yesterdayStart.setUTCHours(0, 0, 0, 0);

// const yesterdayEnd = new Date();
// yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() - 1);
// yesterdayEnd.setUTCHours(23, 59, 59, 999);
// // Booster today
// const [boosterTodayAgg = {}] = await CommunityBoosterReward.aggregate([
//   { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } } },
//   { $group: { _id: null, total: { $sum: "$amount" } } },
// ]);

// const boosterToday = boosterTodayAgg.total
//   ? boosterTodayAgg.total
//   : mongoose.Types.Decimal128.fromString("0.0");




// /* --------------------------------------------------------------
//  * XPower Rewards (today UTC)
//  * ------------------------------------------------------------*/
//  const xpowerTodayStart = new Date();
// xpowerTodayStart.setUTCHours(0, 0, 0, 0);

// const xpowerTodayEnd = new Date();
// xpowerTodayEnd.setUTCHours(23, 59, 59, 999);
// const [xPowerTodayAgg = {}] = await XPowerReward.aggregate([
//   {
//     $match: {
//       ts: { $gte: xpowerTodayStart, $lte: xpowerTodayEnd },
//     },
//   },
//   {
//     $group: {
//       _id: null,
//       total: { $sum: "$amount" },
//     },
//   },
// ]);

// const xPowerToday = xPowerTodayAgg.total
//   ? xPowerTodayAgg.total
//   : mongoose.Types.Decimal128.fromString("0.0");


// /* --------------------------------------------------------------
//  * LP / Airdrop / Boost Rewards follow last distribution date
//  * ------------------------------------------------------------*/
// if (lastDistribution && lastDistribution.ts) {
//   const distDate = lastDistribution.ts;
//   dailyRewards.date = distDate;

//   const distStart = new Date(distDate);
//   distStart.setUTCHours(0, 0, 0, 0);
//   const distEnd = new Date(distDate);
//   distEnd.setUTCHours(23, 59, 59, 999);

//   // LP / Airdrop / Boost totals for last distribution day
//   const ledgerDayTotals = await LedgerRow.aggregate([
//     {
//       $match: {
//         eventType: {
//           $in: [
//             "DAILY_REWARDS_LP",
//             "DAILY_REWARDS_AIRDROP",
//             "DAILY_REWARDS_BOOST",
//           ],
//         },
//         ts: { $gte: distStart, $lte: distEnd },
//       },
//     },
//     { $group: { _id: "$eventType", total: { $sum: "$amount" } } },
//   ]);

//   const ledgerTotalsMap = ledgerDayTotals.reduce((acc, cur) => {
//     acc[cur._id] = cur.total;
//     return acc;
//   }, {});

//   const lpTotal =
//     ledgerTotalsMap["DAILY_REWARDS_LP"] ||
//     mongoose.Types.Decimal128.fromString("0.0");
//   const airdropTotal =
//     ledgerTotalsMap["DAILY_REWARDS_AIRDROP"] ||
//     mongoose.Types.Decimal128.fromString("0.0");
//   const boostTotal =
//     ledgerTotalsMap["DAILY_REWARDS_BOOST"] ||
//     mongoose.Types.Decimal128.fromString("0.0");

//   /* --------------------------------------------
//    * Build final Totals
//    * ------------------------------------------*/
//   const dailyTotal = addDecimal128(
//                         ensureDecimal128(x1Today),
//                         ensureDecimal128(boosterToday),
//                         ensureDecimal128(xPowerToday),
//                         ensureDecimal128(lpTotal),
//                         ensureDecimal128(airdropTotal),
//                         ensureDecimal128(boostTotal),
//                         ensureDecimal128(dailyCascadeTotal)
//                     );

//     dailyRewards = {
//       date: distDate,
//       x1Rewards: x1Today.toString(),
//       xPowerRewards: xPowerToday.toString(), 
//       communityBoosterRewards: boosterToday.toString(),
//       dailyRewardsLp: lpTotal.toString(),
//       dailyRewardsAirdrop: airdropTotal.toString(),
//       dailyRewardsBoost: boostTotal.toString(),
//       dailyCascadeRewards: dailyCascadeTotal.toString(),
//       total: dailyTotal.toString(),
//     };
// }

//     /* --------------------------------------------------------------
//      * Autopositioning report
//      * ------------------------------------------------------------*/

//     const [{ totalAutopositioning = 0 } = {}] = await LedgerRow.aggregate([
//       { $match: { eventType: "AUTOPOSITIONING" } },
//       { $group: { _id: null, totalAutopositioning: { $sum: "$amount" } } },
//     ]);

//     const autopositioningCount = await User.countDocuments({
//       autopositioning: true,
//     });

//     /* --------------------------------------------------------------
//      * EcosystemFee report
//      * ------------------------------------------------------------*/

//     const [
//       { totalEcosystemFee = mongoose.Types.Decimal128.fromString("0.0") } = {},
//     ] = await EcosystemFee.aggregate([
//       { $group: { _id: null, totalEcosystemFee: { $sum: "$amount" } } },
//     ]);

//         /* --------------------------------------------------------------
//      * On-chain deposits & withdrawals (today only)
//      * ------------------------------------------------------------*/
//     const startOfToday = new Date();
//     startOfToday.setUTCHours(0, 0, 0, 0);
//     const endOfToday = new Date();
//     endOfToday.setUTCHours(23, 59, 59, 999);

//     // Deposits today
//     const [depositsToday = {}] = await ChainDeposit.aggregate([
//       {
//        $match: { txDate: { $gte: startOfToday, $lte: endOfToday } }
//       },
//       {
//         $facet: {
//           totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
//           txCount: [{ $count: "count" }],
//           userCount: [
//             { $group: { _id: "$userId" } },
//             { $count: "count" }
//           ]
//         }
//       }
//     ]);

//     const onChainDepositsToday = {
//       total: depositsToday.totalAmount?.[0]?.total || 0,
//       txCount: depositsToday.txCount?.[0]?.count || 0,
//       userCount: depositsToday.userCount?.[0]?.count || 0
//     };

//     // Withdrawals today
//     const [withdrawalsToday = {}] = await ChainWithdrawal.aggregate([
//       {
//         $match: { txDate: { $gte: startOfToday, $lte: endOfToday } }
//       },
//       {
//         $facet: {
//           totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
//           txCount: [{ $count: "count" }],
//           userCount: [
//             { $group: { _id: "$userId" } },
//             { $count: "count" }
//           ]
//         }
//       }
//     ]);

//     const onChainWithdrawalsToday = {
//       total: withdrawalsToday.totalAmount?.[0]?.total || 0,
//       txCount: withdrawalsToday.txCount?.[0]?.count || 0,
//       userCount: withdrawalsToday.userCount?.[0]?.count || 0
//     };

//     /* --------------------------------------------------------------
//  * Ecosystem Fees (today only)
//  * ------------------------------------------------------------*/
// const [ecosystemFeesTodayAgg = {}] = await EcosystemFee.aggregate([
//   {
//     $match: { ts: { $gte: startOfToday, $lte: endOfToday } }
//   },
//   {
//     $facet: {
//       totalAmount: [
//         { $group: { _id: null, total: { $sum: "$amount" } } }
//       ],
//       txCount: [{ $count: "count" }],
//       userCount: [
//         { $group: { _id: "$userId" } },
//         { $count: "count" }
//       ]
//     }
//   }
// ]);

// const ecosystemFeesToday = {
//   total: ecosystemFeesTodayAgg.totalAmount?.[0]?.total
//     ? ecosystemFeesTodayAgg.totalAmount[0].total.toString()
//     : "0.0",
//   txCount: ecosystemFeesTodayAgg.txCount?.[0]?.count || 0,
//   userCount: ecosystemFeesTodayAgg.userCount?.[0]?.count || 0
// };

//     /* --------------------------------------------------------------
//      * Active LP Users
//      * ------------------------------------------------------------*/
//     const activeLPUsers = await Ledger.countDocuments({
//       "wallets.lp": { $gt: mongoose.Types.Decimal128.fromString("0.0") }
//     });
//  /* --------------------------------------------------------------
//      * LP Positioning Today
//      * ------------------------------------------------------------*/
//     const [lpPositioningTodayAgg = {}] = await LedgerRow.aggregate([
//       {
//         $match: {
//           ts: { $gte: startOfToday, $lte: endOfToday },
//           $or: [
//             { eventType: "AUTOPOSITIONING" },
//             { walletFrom: "USDT", walletTo: "LP" }
//           ]
//         }
//       },
//       {
//         $group: {
//           _id: "$eventType",
//           total: { $sum: "$amount" }
//         }
//       }
//     ]);

//     // Separate totals for USDT → LP and AUTOPOSITIONING
//     const lpPositioningTodayAggAll = await LedgerRow.aggregate([
//       {
//         $match: {
//           ts: { $gte: startOfToday, $lte: endOfToday },
//           $or: [
//             { eventType: "AUTOPOSITIONING" },
//             { walletFrom: "USDT", walletTo: "LP" }
//           ]
//         }
//       },
//       {
//         $group: {
//           _id: {
//             eventType: "$eventType",
//             walletFrom: "$walletFrom",
//             walletTo: "$walletTo"
//           },
//           total: { $sum: "$amount" }
//         }
//       }
//     ]);

//     let usdtToLpToday = mongoose.Types.Decimal128.fromString("0.0");
//     let autoPositioningToday = mongoose.Types.Decimal128.fromString("0.0");

//     lpPositioningTodayAggAll.forEach((row) => {
//       if (row._id.eventType === "AUTOPOSITIONING") {
//         autoPositioningToday = row.total;
//       } else if (
//         row._id.walletFrom === "USDT" &&
//         row._id.walletTo === "LP"
//       ) {
//         usdtToLpToday = row.total;
//       }
//     });

//     const LPPositioningToday = {
//       UsdtToLP: usdtToLpToday.toString(),
//       AutoPositioning: autoPositioningToday.toString()
//     };

//     /* --------------------------------------------------------------
//  * Rewards Redeemed (today only)
//  * ------------------------------------------------------------*/
// const [rewardsRedeemedTodayAgg = {}] = await LedgerRow.aggregate([
//   {
//     $match: {
//       eventType: "REWARDS_REDEEMED",
//       ts: { $gte: startOfToday, $lte: endOfToday },
//     },
//   },
//   {
//     $facet: {
//       totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
//       txCount: [{ $count: "count" }],
//       userCount: [{ $group: { _id: "$userId" } }, { $count: "count" }],
//     },
//   },
// ]);

// const rewardsRedeemedToday = {
//   total: rewardsRedeemedTodayAgg.totalAmount?.[0]?.total
//     ? rewardsRedeemedTodayAgg.totalAmount[0].total.toString()
//     : "0.0",
//   txCount: rewardsRedeemedTodayAgg.txCount?.[0]?.count || 0,
//   userCount: rewardsRedeemedTodayAgg.userCount?.[0]?.count || 0,
// };

// /* --------------------------------------------------------------
//  * Claimed Today (ZERO_RISK → WITHDRAWAL)
//  * ------------------------------------------------------------*/
// const [claimedTodayAgg = {}] = await LedgerRow.aggregate([
//   {
//     $match: {
//       eventType: "WITHDRAWAL",
//       walletFrom: "ZERO_RISK",
//       ts: { $gte: startOfToday, $lte: endOfToday },
//     },
//   },
//   {
//     $facet: {
//       totalAmount: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
//       txCount: [{ $count: "count" }],
//       userCount: [{ $group: { _id: "$userId" } }, { $count: "count" }],
//     },
//   },
// ]);

// const claimedToday = {
//   total: claimedTodayAgg.totalAmount?.[0]?.total
//     ? claimedTodayAgg.totalAmount[0].total.toString()
//     : "0.0",
//   txCount: claimedTodayAgg.txCount?.[0]?.count || 0,
//   userCount: claimedTodayAgg.userCount?.[0]?.count || 0,
// };


//     /* --------------------------------------------------------------
//      * Assemble final report
//      * ------------------------------------------------------------*/
//     const report = {
//       totalPositiveLP: ledgerTotals
//         ? ledgerTotals.totalPositiveLP.toString()
//         : "0.0",
//       totalNegativeLP: ledgerTotals
//         ? ledgerTotals.totalNegativeLP.toString()
//         : "0.0",
//       total5xUsed: ledgerTotals ? ledgerTotals.total5xUsed.toString() : "0.0",
//       totalCascadeRewards: ledgerTotals
//         ? ledgerTotals.totalCascadeRewards.toString()
//         : "0.0",
//       totalX1Rewards: x1RewardsTotal.toString(),
//       X1RewarduserCount :X1RewarduserCount.toString(),
//       totalCommunityBoosterRewards: boosterRewardsTotal.toString(),
//       totalAirdrop: ledgerTotals
//         ? ledgerTotals.totalAirdropWallet.toString()
//         : "0.0",
//       totalBooster: ledgerTotals
//         ? ledgerTotals.totalBoosterWallet.toString()
//         : "0.0",
//       totalLP: ledgerTotals ? ledgerTotals.totalLPWallet.toString() : "0.0",
//       totalZeroRisk: ledgerTotals
//         ? ledgerTotals.totalZeroRiskWallet.toString()
//         : "0.0",
//       totalUsdt: ledgerTotals
//         ? ledgerTotals.totalUsdtWallet.toString()
//         : "0.0",
//       totalCommunityRewards: ledgerTotals
//         ? ledgerTotals.totalCommunityRewardsWallet.toString()
//         : "0.0",
//       totalAutopositioning: totalAutopositioning.toString(),
//       totalEcosystemFee: totalEcosystemFee
//         ? totalEcosystemFee.toString()
//         : "0.0",
//       onChainDeposits: onChainDeposits.toString(),
//       onChainWithdrawals: onChainWithdrawals.toString(),
//       distributedLpRewards: distributedLpRewards.toString(),
//       distributedAirdropRewards: distributedAirdropRewards.toString(),
//       distributedBoosterRewards: distributedBoosterRewards.toString(),
//       lastDistributionDate: dailyRewards.date,
//       usersWithUsdtGtZero: userCountusdt,
//       UserWithAutopositioning: autopositioningCount,
//       userCountcommunityRewards: userCountcommunityRewards,
//       userCountzeroRisk: userCountzeroRisk,
//       dailyRewards,
//       onChainDepositsToday,
//       onChainWithdrawalsToday,
//       LPPositioningToday,
//       ecosystemFeesToday,
//       rewardsRedeemedToday,
//       claimedToday,
//       activeLPUsers,
//     };

//     res.status(200).json({ success: true, data: report });
//   } catch (error) {
//     console.error("API System Report Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error while generating the system report.",
//     });
//   }
// };

exports.getSystemReport = async (req, res) => {
  try {
    const Decimal128 = mongoose.Types.Decimal128;

    /* =======================
     * DATE RANGES (UTC)
     * ======================= */
    const now = new Date();

    const todayStart = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
    ));
    const todayEnd = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999
    ));

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

    const yesterdayEnd = new Date(todayEnd);
    yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() - 1);

    // Look back 90 days for last distribution to avoid scanning entire collection
    const distLookback = new Date(todayStart);
    distLookback.setUTCDate(distLookback.getUTCDate() - 90);

    /* =======================
     * ALL QUERIES IN PARALLEL - Single Promise.all
     * ======================= */
    const [
      ledgerTotalsArr,
      userCountsAgg,
      autopositioningCount,
      activeLPUsers,

      x1Facet,
      boosterLifetimeAgg,

      x1TodayAgg,
      boosterYesterdayAgg,
      xPowerTodayAgg,
      cascadeYesterdayAgg,

      chainDepositLifetimeAgg,
      chainWithdrawalLifetimeAgg,

      ecosystemFeeLifetimeAgg,

      totalAutopositioningAgg,
      autopositioningWalletAgg,

      // Previously sequential - now parallel
      depositsAgg,
      withdrawalsAgg,
      ledgerRowAgg,
    ] = await Promise.all([

      /* Ledger Totals */
      Ledger.aggregate([
        {
          $group: {
            _id: null,
            totalPositiveLP: { $sum: { $cond: [{ $gt: ["$wallets.lp", 0] }, "$wallets.lp", 0] } },
            totalNegativeLP: { $sum: { $cond: [{ $lt: ["$wallets.lp", 0] }, "$wallets.lp", 0] } },
            total5xUsed: { $sum: "$limits.fiveXLimit.used" },
            totalCascadeRewards: { $sum: "$wallets.cascadeRewards" },
            totalAirdropWallet: { $sum: "$wallets.airdrop" },
            totalBoosterWallet: { $sum: "$wallets.boost" },
            totalLPWallet: { $sum: "$wallets.lp" },
            totalZeroRiskWallet: { $sum: "$wallets.zeroRisk" },
            totalUsdtWallet: { $sum: "$wallets.bnb" },
            totalCommunityRewardsWallet: { $sum: "$wallets.communityRewards" }
          }
        }
      ]),

      /* User counts via single aggregation facet (replaces 3 slow .distinct() calls) */
      Ledger.aggregate([
        {
          $facet: {
            usdtUsers: [
              { $match: { "wallets.bnb": { $gt: Decimal128.fromString("0") } } },
              { $count: "count" }
            ],
            zeroRiskUsers: [
              { $match: { "wallets.zeroRisk": { $gt: Decimal128.fromString("0") } } },
              { $count: "count" }
            ],
            communityRewardsUsers: [
              { $match: { "wallets.communityRewards": { $gt: Decimal128.fromString("0") } } },
              { $count: "count" }
            ]
          }
        }
      ]),

      User.countDocuments({ autopositioning: true }),
      Ledger.countDocuments({ "wallets.lp": { $gt: Decimal128.fromString("0") } }),

      /* X1 lifetime */
      X1Reward.aggregate([
        {
          $facet: {
            totalRewards: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
            distinctUsers: [{ $group: { _id: "$userId" } }, { $count: "count" }]
          }
        }
      ]),

      /* Booster lifetime */
      CommunityBoosterReward.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      /* X1 Today */
      X1Reward.aggregate([
        { $match: { ts: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      /* Booster Yesterday */
      CommunityBoosterReward.aggregate([
        { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      /* XPower Today */
      XPowerReward.aggregate([
        { $match: { ts: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      /* Cascade Yesterday */
      CascadeReward.aggregate([
        { $match: { createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),

      /* On-chain lifetime totals */
      ChainDeposit.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),
      ChainWithdrawal.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),

      /* Ecosystem fee lifetime */
      EcosystemFee.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]),

      /* Total Autopositioning (amount sum) */
      LedgerRow.aggregate([
        { $match: { eventType: "AUTOPOSITIONING" } },
        { $group: { _id: null, totalAutopositioning: { $sum: "$amount" } } }
      ]),

      /* Wallet Autopositioning (count + sum) */
      Ledger.aggregate([
        { $match: { "wallets.autopositionting": { $gt: Decimal128.fromString("0") } } },
        { $group: { _id: null, userCount: { $sum: 1 }, totalAmount: { $sum: "$wallets.autopositionting" } } }
      ]),

      /* Deposits per user - previously sequential, now parallel */
      ChainDeposit.aggregate([
        { $group: { _id: "$userId", total: { $sum: "$amount" } } }
      ]),

      /* Withdrawals per user - previously sequential, now parallel */
      ChainWithdrawal.aggregate([
        { $group: { _id: "$userId", total: { $sum: "$amount" } } }
      ]),

      /* LedgerRow facet (lifetime + last 90 days dist) - previously two sequential calls, now one */
      LedgerRow.aggregate([
        {
          $facet: {
            lastDistribution: [
              { $match: { eventType: { $in: ["DAILY_REWARDS_LP", "DAILY_REWARDS_AIRDROP", "DAILY_REWARDS_BOOST"] }, ts: { $gte: distLookback } } },
              { $sort: { ts: -1 } },
              { $limit: 1 }
            ],
            lifetimeRewards: [
              { $match: { eventType: { $in: ["DAILY_REWARDS_LP", "DAILY_REWARDS_AIRDROP", "DAILY_REWARDS_BOOST"] } } },
              { $group: { _id: "$eventType", total: { $sum: "$amount" } } }
            ],
            // Get last-distribution-day totals in same query (covers last 90 days on same facet)
            distDayRewards: [
              { $match: { eventType: { $in: ["DAILY_REWARDS_LP", "DAILY_REWARDS_AIRDROP", "DAILY_REWARDS_BOOST"] }, ts: { $gte: distLookback } } },
              { $sort: { ts: -1 } },
              { $limit: 5000 }, // generous limit to capture all of the most recent distribution day
              { $group: { _id: { eventType: "$eventType", day: { $dateToString: { format: "%Y-%m-%d", date: "$ts", timezone: "UTC" } } }, total: { $sum: "$amount" } } }
            ]
          }
        }
      ]),
    ]);

    /* =======================
     * PROCESS PARALLEL RESULTS
     * ======================= */
    const ledgerTotals = ledgerTotalsArr?.[0] || {};

    // User counts from single facet
    const userCountusdt = userCountsAgg?.[0]?.usdtUsers?.[0]?.count || 0;
    const userCountzeroRisk = userCountsAgg?.[0]?.zeroRiskUsers?.[0]?.count || 0;
    const userCountcommunityRewards = userCountsAgg?.[0]?.communityRewardsUsers?.[0]?.count || 0;

    // Autopositioning wallet
    const autopositioningWalletUsers = autopositioningWalletAgg?.[0]?.userCount || 0;
    const autopositioningWalletTotal = autopositioningWalletAgg?.[0]?.totalAmount || Decimal128.fromString("0");

    // On-chain balance analysis (now from parallel deposits/withdrawals)
    const depositMap = Object.fromEntries(
      depositsAgg.map(d => [d._id.toString(), toNumber(d.total)])
    );
    const withdrawalMap = Object.fromEntries(
      withdrawalsAgg.map(w => [w._id.toString(), toNumber(w.total)])
    );

    let negativeUserCount = 0, totalExtraWithdrawal = 0;
    for (const [userId, withdrawalTotal] of Object.entries(withdrawalMap)) {
      const depositTotal = depositMap[userId] || 0;
      if (withdrawalTotal > depositTotal) {
        negativeUserCount++;
        totalExtraWithdrawal += (withdrawalTotal - depositTotal);
      }
    }

    let positiveUserCount = 0, totalExtraDeposit = 0;
    for (const [userId, depositTotal] of Object.entries(depositMap)) {
      const withdrawalTotal = withdrawalMap[userId] || 0;
      if (depositTotal > withdrawalTotal) {
        positiveUserCount++;
        totalExtraDeposit += (depositTotal - withdrawalTotal);
      }
    }

    const onChainNegativeUsers = negativeUserCount;
    const onChainExtraWithdrawal = totalExtraWithdrawal;
    const onChainPositiveUsers = positiveUserCount;
    const onChainExtraDeposit = totalExtraDeposit;

    // LedgerRow results (all from single parallel query)
    const lastDistribution = ledgerRowAgg[0]?.lastDistribution?.[0] || null;

    const lifetimeMap = {};
    ledgerRowAgg[0]?.lifetimeRewards?.forEach(r => (lifetimeMap[r._id] = r.total));

    const distributedLpRewards = lifetimeMap["DAILY_REWARDS_LP"] || Decimal128.fromString("0");
    const distributedAirdropRewards = lifetimeMap["DAILY_REWARDS_AIRDROP"] || Decimal128.fromString("0");
    const distributedBoosterRewards = lifetimeMap["DAILY_REWARDS_BOOST"] || Decimal128.fromString("0");

    /* Distribution day totals from pre-fetched distDayRewards facet */
    let lpTotal = Decimal128.fromString("0");
    let airdropTotal = Decimal128.fromString("0");
    let boostTotal = Decimal128.fromString("0");
    let distDate = null;

    if (lastDistribution?.ts) {
      distDate = lastDistribution.ts;
      const distDayStr = new Date(distDate).toISOString().slice(0, 10);

      const distDayRewards = ledgerRowAgg[0]?.distDayRewards || [];
      for (const r of distDayRewards) {
        if (r._id.day !== distDayStr) continue;
        if (r._id.eventType === "DAILY_REWARDS_LP") lpTotal = r.total;
        if (r._id.eventType === "DAILY_REWARDS_AIRDROP") airdropTotal = r.total;
        if (r._id.eventType === "DAILY_REWARDS_BOOST") boostTotal = r.total;
      }
    }

    /* =======================
     * Today/Yesterday totals
     * ======================= */
    const x1Today = x1TodayAgg[0]?.total || Decimal128.fromString("0");
    const boosterToday = boosterYesterdayAgg[0]?.total || Decimal128.fromString("0");
    const xPowerToday = xPowerTodayAgg[0]?.total || Decimal128.fromString("0");
    const dailyCascadeTotal = cascadeYesterdayAgg[0]?.total || Decimal128.fromString("0");

    const dailyTotal = addDecimal128(
      x1Today, boosterToday, xPowerToday, lpTotal, airdropTotal, boostTotal, dailyCascadeTotal
    );

    /* =======================
     * Other totals
     * ======================= */
    const onChainDeposits = chainDepositLifetimeAgg[0]?.total || 0;
    const onChainWithdrawals = chainWithdrawalLifetimeAgg[0]?.total || 0;
    const totalEcosystemFee = ecosystemFeeLifetimeAgg[0]?.total || Decimal128.fromString("0");
    const totalAutopositioning = totalAutopositioningAgg?.[0]?.totalAutopositioning || Decimal128.fromString("0");

    /* =======================
     * REPORT
     * ======================= */
    const report = {
      totalPositiveLP: ledgerTotals.totalPositiveLP?.toString() || "0.0",
      totalNegativeLP: ledgerTotals.totalNegativeLP?.toString() || "0.0",
      total5xUsed: ledgerTotals.total5xUsed?.toString() || "0.0",
      totalCascadeRewards: ledgerTotals.totalCascadeRewards?.toString() || "0.0",

      totalX1Rewards: x1Facet[0]?.totalRewards?.[0]?.total?.toString() || "0.0",
      X1RewarduserCount: x1Facet[0]?.distinctUsers?.[0]?.count || 0,

      totalCommunityBoosterRewards: boosterLifetimeAgg[0]?.total?.toString() || "0.0",

      totalAirdrop: ledgerTotals.totalAirdropWallet?.toString() || "0.0",
      totalBooster: ledgerTotals.totalBoosterWallet?.toString() || "0.0",
      totalLP: ledgerTotals.totalLPWallet?.toString() || "0.0",
      totalZeroRisk: ledgerTotals.totalZeroRiskWallet?.toString() || "0.0",
      totalUsdt: ledgerTotals.totalUsdtWallet?.toString() || "0.0",
      totalCommunityRewards: ledgerTotals.totalCommunityRewardsWallet?.toString() || "0.0",

      totalAutopositioning: totalAutopositioning.toString(),
      totalEcosystemFee: totalEcosystemFee.toString(),

      onChainDeposits: onChainDeposits.toString(),
      onChainWithdrawals: onChainWithdrawals.toString(),

      distributedLpRewards: distributedLpRewards.toString(),
      distributedAirdropRewards: distributedAirdropRewards.toString(),
      distributedBoosterRewards: distributedBoosterRewards.toString(),

      lastDistributionDate: distDate,

      usersWithUsdtGtZero: userCountusdt,
      UserWithAutopositioning: autopositioningCount,
      userCountcommunityRewards,
      userCountzeroRisk,

      dailyRewards: {
        date: distDate,
        x1Rewards: x1Today.toString(),
        xPowerRewards: xPowerToday.toString(),
        communityBoosterRewards: boosterToday.toString(),
        dailyRewardsLp: lpTotal.toString(),
        dailyRewardsAirdrop: airdropTotal.toString(),
        dailyRewardsBoost: boostTotal.toString(),
        dailyCascadeRewards: dailyCascadeTotal.toString(),
        total: dailyTotal.toString()
      },
      autopositioningWallet: {
        userCount: autopositioningWalletUsers,
        total: autopositioningWalletTotal.toString()
      },
      onChainNegativeBalance: {
        userCount: onChainNegativeUsers,
        extraWithdrawn: onChainExtraWithdrawal.toString()
      },
      onChainPositiveBalance: {
        userCount: onChainPositiveUsers,
        extraDeposited: onChainExtraDeposit.toString()
      },

      activeLPUsers
    };

    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error("API System Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while generating the system report.",
    });
  }
};


exports.getEcofeeReport = async (req, res) => {
  try {
    const {
      transactionId,
      source: bodySource,
      destination: bodyDestination,
      amount: bodyAmount,
    } = req.body;

    // If you resolve BSC tx elsewhere, plug values here; otherwise use body fallbacks
    const source = bodySource || null;
    const destination = bodyDestination || null;
    const amount = typeof bodyAmount === "number" ? bodyAmount : null; // optional
    const raw = req.body.fullTransaction || null; // optional

    // ---- EcosystemFee report (grand total + rows with username) ----
    const ecoReportAgg = await EcosystemFee.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          userId: 1,
          amount: 1, // Decimal128
          walletFrom: 1,
          eventType: 1,
          ledgerRefId: 1,
          narrative: 1,
          ts: 1,
          updatedAt: 1,
          username: "$user.username",
          email: "$user.email",
          uhid: "$user.uhid",
        },
      },
      { $sort: { ts: -1 } },
      {
        $facet: {
          rows: [],
          grandTotal: [
            {
              $group: {
                _id: null,
                totalEcosystemFee: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const { rows = [], grandTotal = [] } = ecoReportAgg[0] || {};
    const totalEcosystemFee =
      grandTotal[0]?.totalEcosystemFee?.toString?.() || "0";
    const totalCount = grandTotal[0]?.count || 0;

    // 🔍 User by wallet address (only if we have a source address)
    let user = null;
    if (source) {
      // exact match; if you need case-insensitive, switch to regex (and consider an index)
      user = await User.findOne({ wallet_address: source }).select(
        "_id email username uhid"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Ecosystem fee report fetched successfully",
      data: {
        // BSC-ish fields (may be null if not provided)
        transactionId: transactionId || null,
        source,
        destination,
        amount:
          typeof amount === "number" ? amount.toFixed(6) : amount,
        user, // null if not found or no source provided
        fullTransaction: raw,

        // Report
        ecosystemFee: {
          total: totalEcosystemFee, // Decimal128 as string
          count: totalCount,
          rows: rows.map((r) => ({
            ...r,
            amountStr: r.amount?.toString?.() ?? "0",
          })),
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in getEcofeeReport:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (error?.message || "Unknown error"),
    });
  }
};

/**
 * GET autopositioning report
 * Filters (all optional): start, end, userId, walletSide ("FROM" | "TO" | "ANY")
 * Pagination: page (1-based), pageSize
 * BSC-ish passthroughs: transactionId, source, destination, amount, fullTransaction
 */
exports.getAutopositioningReport = async (req, res) => {
  try {
    const {
      source: bodySource,
      destination: bodyDestination,
      amount: bodyAmount,
      fullTransaction,
      start,
      end,
      userId,
      walletSide = "ANY",
      page = 1,
      pageSize = 50,
      sortDir = -1,
    } = req.body || req.query || {};

    const source = bodySource || null;
    const destination = bodyDestination || null;
    const amountFilter = typeof bodyAmount === "number" ? bodyAmount : null;
    const raw = fullTransaction || null;

    // ---- Build match ----
    const match = { eventType: "AUTOPOSITIONING" };
    if (start || end) {
      match.ts = {};
      if (start) match.ts.$gte = new Date(start);
      if (end) match.ts.$lte = new Date(end);
    }
    if (userId) {
      match.userId = new mongoose.Types.ObjectId(String(userId));
    }

    // Optional wallet-side filter for Community Rewards flows
    if (walletSide === "FROM") {
      match.walletFrom = "COMMUNITY_REWARDS";
    } else if (walletSide === "TO") {
      match.walletTo = "COMMUNITY_REWARDS";
    } // "ANY" skips wallet filter

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
    const skip = (_page - 1) * _pageSize;

    const agg = await LedgerRow.aggregate([
      { $match: match },

      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          userId: 1,
          amount: 1, // Decimal128
          eventType: 1,
          walletFrom: 1,
          walletTo: 1,
          ledgerRefId: 1,
          narrative: 1,
          ts: 1,
          updatedAt: 1,
          username: "$user.username",
          email: "$user.email",
          uhid: "$user.uhid",
        },
      },

      { $sort: { ts: Number(sortDir) === 1 ? 1 : -1 } },

      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          grandTotal: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], grandTotal: [] };
    const rows = (facet.rows || []).map((r) => ({
      ...r,
      amountStr: r.amount?.toString?.() ?? "0",
    }));
    const totalAmount = facet.grandTotal?.[0]?.totalAmount?.toString?.() ?? "0";
    const totalCount = facet.grandTotal?.[0]?.count ?? 0;

    // Optional: resolve user by wallet address if provided
    let user = null;
    if (source) {
      user = await User.findOne({ wallet_address: source }).select(
        "_id email username uhid"
      );
    }

    return res.status(200).json({
      success: true,
      message: "Autopositioning report fetched successfully",
      data: {
        source,
        destination,
        amount:
          typeof amountFilter === "number"
            ? amountFilter.toFixed(6)
            : amountFilter,
        user, // null if not found or not provided
        fullTransaction: raw,

        autopositioning: {
          total: totalAmount, // Decimal128 string
          count: totalCount,
          page: _page,
          pageSize: _pageSize,
          rows,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in getAutopositioningReport:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (error?.message || "Unknown error"),
    });
  }
};

/**
 * GET USDT wallet report
 * Body (all optional unless noted):
 * - start, end: ISO date strings
 * - userId: ObjectId|string
 * - direction: "FROM" | "TO" | "ANY"   (default "ANY")
 * - eventTypes: string[]                (limit to specific types if you want)
 * - page, pageSize, sortDir             (default 1, 50, -1)
 * - transactionId, source, destination, amount, fullTransaction (passthrough)
 */
exports.getUsdtReport = async (req, res) => {
  try {
    const {
      // filters
      start,
      end,
      userId,
      direction = "ANY", // "FROM" | "TO" | "ANY"
      eventTypes, // e.g., ["USDT_DEPOSIT", "USDT_WITHDRAWAL"]

      // paging/sort
      page = 1,
      pageSize = 50,
      sortDir = -1, // newest first
    } = req.query; // ✅ now reading from query

    // Build match
    const match = {};
    if (start || end) {
      match.ts = {};
      if (start) match.ts.$gte = new Date(start);
      if (end) match.ts.$lte = new Date(end);
    }
    if (userId) {
      match.userId = new mongoose.Types.ObjectId(String(userId));
    }

    // Wallet side for USDT
    if (direction === "FROM") {
      match.walletFrom = "USDT";
    } else if (direction === "TO") {
      match.walletTo = "USDT";
    } else {
      // ANY: include rows where either side is USDT
      match.$or = [{ walletFrom: "USDT" }, { walletTo: "USDT" }];
    }

    // Optional event type filter
    if (Array.isArray(eventTypes) && eventTypes.length) {
      match.eventType = { $in: eventTypes };
    }

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 50));
    const skip = (_page - 1) * _pageSize;

    const agg = await LedgerRow.aggregate([
      { $match: match },

      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 1,
          userId: 1,
          amount: 1, // Decimal128
          eventType: 1,
          walletFrom: 1,
          walletTo: 1,
          ledgerRefId: 1,
          narrative: 1,
          ts: 1,
          updatedAt: 1,
          username: "$user.username",
          email: "$user.email",
          uhid: "$user.uhid",
        },
      },

      { $sort: { ts: Number(sortDir) === 1 ? 1 : -1 } },

      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          grandTotal: [
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], grandTotal: [] };
    const rows = (facet.rows || []).map((r) => ({
      ...r,
      amountStr:
        r.amount != null ? parseFloat(r.amount.toString()).toFixed(2) : "0.00",
    }));

    const totalAmount =
      facet.grandTotal?.[0]?.totalAmount != null
        ? parseFloat(facet.grandTotal[0].totalAmount.toString()).toFixed(2)
        : "0.00";

    const totalCount = facet.grandTotal?.[0]?.count ?? 0;

    return res.status(200).json({
      success: true,
      message: "USDT report fetched successfully",
      data: {
        usdt: {
          total: totalAmount,
          count: totalCount,
          page: _page,
          pageSize: _pageSize,
          rows,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error in getUsdtReport:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (error?.message || "Unknown error"),
    });
  }
};

/**
 * GET users and their USDT balances (from Ledger.wallets.bnb)
 *
 * Body/Query (all optional):
 *  - minBalance: string|number (default "0")  // use "0" for > 0, set "-inf" to include zeros
 *  - page: number (default 1)
 *  - pageSize: number (default 100)
 *  - sortDir: -1 | 1  (default -1 = highest balance first)
 *
 * Response:
 *  {
 *    totalUsers, totalAmount, page, pageSize,
 *    rows: [{ userId, username, uhid, wallet_address, amountStr }]
 *  }
 */
exports.getUsersUsdtBalancesFromLedger = async (req, res) => {
  try {
    const {
      minBalance = "0", // strictly greater than 0 by default
      page = 1,
      pageSize = 100,
      sortDir = -1,
    } = { ...req.query, ...req.body };

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 100));
    const skip = (_page - 1) * _pageSize;

    // 1) Normalize wallets.bnb to Decimal128
    // 2) Filter by > minBalance
    // 3) Join users to get username
    // 4) Sort, paginate, totals
    const minBalD128 = mongoose.Types.Decimal128.fromString(String(minBalance));

    const agg = await Ledger.aggregate([
      {
        $addFields: {
          usdtBalanceDecimal: {
            $convert: {
              input: "$wallets.bnb",
              to: "decimal",
              onError: { $toDecimal: "0" },
              onNull: { $toDecimal: "0" },
            },
          },
        },
      },
      {
        $match: {
          usdtBalanceDecimal: { $gt: minBalD128 }, // strictly greater than minBalance
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: 1,
          username: "$user.username",
          uhid: "$user.uhid",
          wallet_address: "$user.wallet_address",
          amount: "$usdtBalanceDecimal", // Decimal128
        },
      },
      { $sort: { amount: Number(sortDir) === 1 ? 1 : -1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          totals: [
            {
              $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], totals: [] };
    const totalUsers = facet.totals?.[0]?.totalUsers ?? 0;

    // 🔒 format helper (Decimal128-safe -> "0.00")
    const fmt2 = (dec) =>
      dec != null ? parseFloat(dec.toString()).toFixed(2) : "0.00";

    const totalAmountStr = fmt2(facet.totals?.[0]?.totalAmount);

    const rows = (facet.rows || []).map((r) => ({
      userId: r.userId,
      username: r.username || "(unknown)",
      uhid: r.uhid || "",
      wallet_address: r.wallet_address || "",
      amountStr: fmt2(r.amount),
    }));

    return res.status(200).json({
      success: true,
      message: "Users with USDT balances fetched successfully",
      data: {
        minBalance: String(minBalance),
        totalUsers,
        totalAmount: totalAmountStr, // "xx.yy"
        page: _page,
        pageSize: _pageSize,
        rows, // each with amountStr fixed to 2 decimals
      },
    });
  } catch (err) {
    console.error("❌ Error in getUsersUsdtBalancesFromLedger:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (err?.message || "Unknown error"),
    });
  }
};


/**
 * GET users and their X1Rewards balances (from Ledger.wallets.bnb)
 *
 * Body/Query (all optional):
 *  - minBalance: string|number (default "0")  // use "0" for > 0, set "-inf" to include zeros
 *  - page: number (default 1)
 *  - pageSize: number (default 100)
 *  - sortDir: -1 | 1  (default -1 = highest balance first)
 *
 * Response:
 *  {
 *    totalUsers, totalAmount, page, pageSize,
 *    rows: [{ userId, username, uhid, wallet_address, amountStr }]
 *  }
 */
exports.getUserX1Rewards = async (req, res) => {
  try {
    const {
      userId,
      page = 1,
      pageSize = 50,
      sortDir = -1,
    } = { ...req.query, ...req.body };

    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid userId is required",
      });
    }

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(200, Number(pageSize) || 50));
    const skip = (_page - 1) * _pageSize;

    const agg = await X1Reward.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },

      // join depositor
      {
        $lookup: {
          from: "users",
          localField: "depositorId",
          foreignField: "_id",
          as: "depositor",
        },
      },
      { $unwind: { path: "$depositor", preserveNullAndEmptyArrays: true } },

      // join user (owner)
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 0,
          userId: 1,
          username: "$user.username",
          uhid: "$user.uhid",

          depositorId: 1,
          depositorName: "$depositor.username",
          depositorUhid: "$depositor.uhid",

          amount: 1,
          tier: 1,
          rate: 1,
          level: 1,
          depositAmount: 1,
          ts: 1,
        },
      },

      { $sort: { ts: Number(sortDir) === 1 ? 1 : -1 } },

      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          totals: [
            {
              $group: {
                _id: null,
                totalRecords: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], totals: [] };
    const totalRecords = facet.totals?.[0]?.totalRecords ?? 0;

    const fmt2 = (dec) =>
      dec != null ? parseFloat(dec.toString()).toFixed(6) : "0.000000";

    const totalAmountStr = fmt2(facet.totals?.[0]?.totalAmount);

    const rows = (facet.rows || []).map((r) => ({
      userId: r.userId,
      username: r.username || "(unknown)",
      uhid: r.uhid || "",

      depositorId: r.depositorId,
      depositorName: r.depositorName || "(unknown)",
      depositorUhid: r.depositorUhid || "",

      amount: fmt2(r.amount),
      tier: r.tier,
      rate: r.rate,
      level: r.level,
      depositAmount: fmt2(r.depositAmount),
      ts: r.ts,
    }));

    return res.status(200).json({
      success: true,
      message: "User X1Reward records fetched successfully",
      data: {
        userId,
        totalRecords,
        totalAmount: totalAmountStr,
        page: _page,
        pageSize: _pageSize,
        rows,
      },
    });
  } catch (err) {
    console.error("❌ Error in getUserX1Rewards:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (err?.message || "Unknown error"),
    });
  }
};

/**
 * GET users and their USDT balances (from Ledger.wallets.bnb)
 *
 * Body/Query (all optional):
 *  - minBalance: string|number (default "0")  // use "0" for > 0, set "-inf" to include zeros
 *  - page: number (default 1)
 *  - pageSize: number (default 100)
 *  - sortDir: -1 | 1  (default -1 = highest balance first)
 *
 * Response:
 *  {
 *    totalUsers, totalAmount, page, pageSize,
 *    rows: [{ userId, username, uhid, wallet_address, amountStr }]
 *  }
 */
exports.getUsersx1reawards = async (req, res) => {
  try {
    const {
      minBalance = "0",
      page = 1,
      pageSize = 100,
    } = { ...req.query, ...req.body };

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 100));
    const skip = (_page - 1) * _pageSize;

    const minBalD128 = mongoose.Types.Decimal128.fromString(String(minBalance));

    const agg = await X1Reward.aggregate([
      {
        $group: {
          _id: "$userId",
          totalEarnings: { $sum: "$amount" },
        },
      },
      { $match: { totalEarnings: { $gt: minBalD128 } } },

      // Join user
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Add xRankOrder field to sort properly
      {
        $addFields: {
          xRank: "$user.xRank",
          xRankOrder: {
            $switch: {
              branches: [
                { case: { $eq: ["$user.xRank", "X"] }, then: 0.5 },
                { case: { $eq: ["$user.xRank", "X5"] }, then: 5 },
                { case: { $eq: ["$user.xRank", "X4"] }, then: 4 },
                { case: { $eq: ["$user.xRank", "X3"] }, then: 3 },
                { case: { $eq: ["$user.xRank", "X2"] }, then: 2 },
                { case: { $eq: ["$user.xRank", "X1"] }, then: 1 },
              ],
              default: 0, // for "None" or missing
            },
          },
        },
      },

      {
        $project: {
          _id: 0,
          userId: "$_id",
          username: "$user.username",
          uhid: "$user.uhid",
          wallet_address: "$user.wallet_address",
          xRank: 1,
          totalEarnings: 1,
          xRankOrder: 1,
        },
      },

      // Sort by xRank DESC, then totalEarnings DESC
      { $sort: { xRankOrder: -1, totalEarnings: -1 } },

      { $skip: skip },
      { $limit: _pageSize },
    ]);

    const totalsAgg = await X1Reward.aggregate([
      {
        $group: {
          _id: "$userId",
          totalEarnings: { $sum: "$amount" },
        },
      },
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          totalAmount: { $sum: "$totalEarnings" },
        },
      },
    ]);

    const totals = totalsAgg[0] || { totalUsers: 0, totalAmount: 0 };

    const fmt2 = (dec) =>
      dec != null ? parseFloat(dec.toString()).toFixed(2) : "0.00";

    const rows = agg.map((r) => ({
      userId: r.userId,
      username: r.username || "(unknown)",
      uhid: r.uhid || "",
      wallet_address: r.wallet_address || "",
      xRank: r.xRank || "None",
      totalEarnings: fmt2(r.totalEarnings),
    }));

    return res.status(200).json({
      success: true,
      message: "X1Reward distinct user totals fetched successfully",
      data: {
        minBalance: String(minBalance),
        totalUsers: totals.totalUsers,
        totalAmount: fmt2(totals.totalAmount),
        page: _page,
        pageSize: _pageSize,
        rows,
      },
    });
  } catch (err) {
    console.error("❌ Error in getUsersx1reawards:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (err?.message || "Unknown error"),
    });
  }
};



/**
 * GET list of users with their total AUTOPOSITIONING amount
 *
 * Body/Query (all optional):
 *  - start, end: ISO date strings to filter by ts
 *  - userId: ObjectId|string (filter a single user)
 *  - walletSide: "FROM" | "TO" | "ANY" (default "ANY")
 *      If you only want CR debits: "FROM" (walletFrom: "COMMUNITY_REWARDS")
 *      If you only want CR credits: "TO"   (walletTo:   "COMMUNITY_REWARDS")
 *  - minTotal: string|number (default "0")  // keep only users with total > minTotal
 *  - sortBy: "total" | "lastTs" | "count" (default "total")
 *  - sortDir: -1 | 1 (default -1)
 *  - page: number (default 1)
 *  - pageSize: number (default 100)
 *
 * Response:
 *  {
 *    totalUsers, grandTotal, grandCount, page, pageSize,
 *    rows: [{ userId, username, uhid, wallet_address, totalAmountStr, count, lastTs }]
 *  }
 */
exports.getUsersAutopositioningTotals = async (req, res) => {
  try {
    const {
      start,
      end,
      userId,
      walletSide = "ANY",
      minTotal = "0",
      sortBy = "total", // "total" | "lastTs" | "count"
      sortDir = -1,
      page = 1,
      pageSize = 100,
    } = { ...req.query, ...req.body };

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 100));
    const skip = (_page - 1) * _pageSize;

    // Build base match for AUTOPOSITIONING
    const match = { eventType: "AUTOPOSITIONING" };
    if (start || end) {
      match.ts = {};
      if (start) match.ts.$gte = new Date(start);
      if (end) match.ts.$lte = new Date(end);
    }
    if (userId) {
      match.userId = new mongoose.Types.ObjectId(String(userId));
    }
    if (walletSide === "FROM") {
      match.walletFrom = "COMMUNITY_REWARDS";
    } else if (walletSide === "TO") {
      match.walletTo = "COMMUNITY_REWARDS";
    } // ANY => no wallet side filter

    const minTotalD128 = mongoose.Types.Decimal128.fromString(String(minTotal));

    // Sorting
    const sortStage = {};
    if (sortBy === "lastTs") sortStage.lastTs = Number(sortDir) === 1 ? 1 : -1;
    else if (sortBy === "count")
      sortStage.count = Number(sortDir) === 1 ? 1 : -1;
    else sortStage.totalAmount = Number(sortDir) === 1 ? 1 : -1; // default: total

    const agg = await LedgerRow.aggregate([
      { $match: match },

      // Group per user
      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: "$amount" }, // Decimal128-safe
          count: { $sum: 1 },
          lastTs: { $max: "$ts" },
        },
      },

      // Filter by minTotal (strictly greater than)
      { $match: { totalAmount: { $gt: minTotalD128 } } },

      // Join user to get username and other info
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      // Shape output
      {
        $project: {
          _id: 0,
          userId: "$_id",
          username: "$user.username",
          uhid: "$user.uhid",
          wallet_address: "$user.wallet_address",
          totalAmount: 1, // Decimal128
          count: 1,
          lastTs: 1,
        },
      },

      // Sort & paginate
      { $sort: sortStage },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          totals: [
            {
              $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                grandTotal: { $sum: "$totalAmount" }, // sum of user totals
                grandCount: { $sum: "$count" },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], totals: [] };
    const totalUsers = facet.totals?.[0]?.totalUsers ?? 0;
    const grandTotalStr = facet.totals?.[0]?.grandTotal?.toString?.() ?? "0";
    const grandCount = facet.totals?.[0]?.grandCount ?? 0;

    const rows = (facet.rows || []).map((r) => ({
      userId: r.userId,
      username: r.username || "(unknown)",
      uhid: r.uhid || "",
      wallet_address: r.wallet_address || "",
      totalAmountStr: r.totalAmount?.toString?.() ?? "0",
      count: r.count,
      lastTs: r.lastTs,
    }));

    return res.status(200).json({
      success: true,
      message: "Users' AUTOPOSITIONING totals fetched successfully",
      data: {
        filters: {
          start: start || null,
          end: end || null,
          walletSide,
          minTotal: String(minTotal),
          sortBy,
          sortDir: Number(sortDir),
        },
        totalUsers,
        grandTotal: grandTotalStr, // Decimal128 string
        grandCount,
        page: _page,
        pageSize: _pageSize,
        rows,
      },
    });
  } catch (err) {
    console.error("❌ Error in getUsersAutopositioningTotals:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (err?.message || "Unknown error"),
    });
  }
};
exports.getUsersEcosystemFeeTotals = async (req, res) => {
  try {
    const {
      start,
      end,
      page = 1,
      pageSize = 100,
      sortDir = -1,
    } = { ...req.query, ...req.body };

    const _page = Math.max(1, Number(page) || 1);
    const _pageSize = Math.max(1, Math.min(500, Number(pageSize) || 100));
    const skip = (_page - 1) * _pageSize;

    const match = {};
    if (start || end) {
      match.ts = {};
      if (start) match.ts.$gte = new Date(start);
      if (end) match.ts.$lte = new Date(end);
    }

    const agg = await EcosystemFee.aggregate([
      { $match: match },

      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: "$amount" },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          userId: "$_id",
          _id: 0,
          username: "$user.username",
          totalAmount: 1,
        },
      },

      { $sort: { totalAmount: Number(sortDir) === 1 ? 1 : -1 } },

      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: _pageSize }],
          totals: [
            {
              $group: {
                _id: null,
                userCount: { $sum: 1 },
                grandTotal: { $sum: "$totalAmount" },
              },
            },
          ],
        },
      },
    ]);

    const facet = agg[0] || { rows: [], totals: [] };
    const rows = (facet.rows || []).map((r) => ({
      userId: r.userId,
      username: r.username || "(unknown)",
      amountStr: r.totalAmount?.toString?.() ?? "0",
    }));

    return res.status(200).json({
      success: true,
      message: "Users' ECOSYSTEM_FEE totals fetched successfully",
      data: {
        start: start || null,
        end: end || null,
        totalUsers: facet.totals?.[0]?.userCount ?? 0,
        grandTotal: facet.totals?.[0]?.grandTotal?.toString?.() ?? "0",
        page: _page,
        pageSize: _pageSize,
        rows,
      },
    });
  } catch (err) {
    console.error("❌ Error in getUsersEcosystemFeeTotals:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error: " + (err?.message || "Unknown error"),
    });
  }
};

/**
 * Get Adjustment (single document)
 */
exports.getAdjustment = async (req, res) => {
  try {
    const adjustment = await WithdrawalDepositAdjustment.findOne({})
      .sort({ createdAt: -1 });

    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: "Settings not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Adjustment fetched successfully",
      data: adjustment,
    });
  } catch (error) {
    console.error("Get Adjustment Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update Adjustment (single document)
 */
exports.updateAdjustment = async (req, res) => {
  try {
    const {
      negativeWithdrawal = 0,
      positiveDeposit = 0,
      note,
    } = req.body;

    if (
      Number(negativeWithdrawal) < 0 ||
      Number(positiveDeposit) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Values must be positive numbers",
      });
    }

    const update = {
      negativeWithdrawal: Number(negativeWithdrawal),
      positiveDeposit: Number(positiveDeposit),
      note,
      createdBy: req.user?._id, // optional (if auth middleware exists)
    };

    const adjustment = await WithdrawalDepositAdjustment.findOneAndUpdate(
      {},
      update,
      {
        new: true,
        sort: { createdAt: -1 },
      }
    );

    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: "Settings not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Adjustment updated successfully",
      data: adjustment,
    });
  } catch (error) {
    console.error("Update Adjustment Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Delete Adjustment (single document)
 */
exports.deleteAdjustment = async (req, res) => {
  try {
    const adjustment = await WithdrawalDepositAdjustment.findOneAndDelete(
      {},
      { sort: { createdAt: -1 } }
    );

    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: "Settings not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Adjustment deleted successfully",
      data: adjustment,
    });
  } catch (error) {
    console.error("Delete Adjustment Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
