require('dotenv').config();
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const LedgerRow = require("../models/LedgerRow");
const DailyUserLp = require("../models/DailyUserLp");
const EcosystemFee = require("../models/EcosystemFee");
const CascadeReward = require("../models/CascadeReward");
const CommunityBoosterReward = require("../models/CommunityBoosterReward");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const x1reward = require("../models/X1Reward");
const Level = require("../models/Level");
const { sendUsdt } = require("../utils/usdtTransactions");
const mongoose = require("mongoose");
const cron = require("node-cron");
const Decimal128 = mongoose.Types.Decimal128;
const {
  getOrCreateLedger,
  createLedgerEntry,
} = require("../jobs/helpers/ledgerHelpers");
const { ROI_SLABS } = require("../utils/constants");
const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  ensureDecimal128,
  compareDecimal128,
  minDecimal128,
  maxDecimal128,
  roundTo6Decimal128,
} = require("../utils/decimal128Utils");
const UserUsdtAirdrop = require("../models/UserUsdtAirdrop");
const {
  updateUplineTeamLp,
  decreaseUplineTeamLp,
} = require("../services/lpService");
const airdropPromotionConfig = require("../config/airdropPromotionConfig");
const Decimal = require("decimal.js");
const usdtTransactions = require("../utils/usdtTransactions");
const DailyRewardLog = require("../models/DailyRewardLog");
const CUTOFF_YMD = "2025-08-09";

function toLocalMidnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isOnOrAfterCutoff(dateLike) {
  const cutoff = toLocalMidnight(new Date(CUTOFF_YMD));
  const dt = toLocalMidnight(new Date(dateLike));
  return dt.getTime() >= cutoff.getTime();
}


const getLedgerDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const ledger = await getOrCreateLedger(userId);

    if (!ledger) {
      return res.status(200).json({
        success: true,
        message: "Ledger details not found, defaults returned.",
        data: {},
      });
    }

    /* ================== SAFE DECIMAL HELPERS ================== */
    const toNumber = (v) => Number(v?.toString?.() || 0);

    /* ================== BASE BALANCES ================== */
    const rawLpBalance = ledger.wallets.lp?.toString() || "0.0";
    const rawUsdtBalance = ledger.wallets.usdt?.toString() || "0.0";
    const rawZeroRisk = ledger.wallets.zeroRisk?.toString() || "0.0";

    /* ================== 5X LIMIT ================== */
    const fiveXLimitCap = multiplyDecimal128(rawLpBalance, "5");

    /* ================== DATE RANGE ================== */
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    /* ================== REWARD BREAKDOWN ================== */
    const rewardBreakdownByType = {};

    const sumLedgerAmounts = async (query) => {
      const rows = await LedgerRow.find(query).select("amount").lean();
      return rows.reduce((sum, r) => sum + toNumber(r.amount), 0);
    };

    rewardBreakdownByType.AUTOPOSITION_TODAY = await sumLedgerAmounts({
      userId,
      walletFrom: "COMMUNITY_REWARDS",
      eventType: "AUTOPOSITIONING",
      ts: { $gte: startOfToday, $lte: endOfToday },
    });

    rewardBreakdownByType.AUTOPOSITION = await sumLedgerAmounts({
      userId,
      walletFrom: "COMMUNITY_REWARDS",
      eventType: "AUTOPOSITIONING",
    });

  
    rewardBreakdownByType["DAILY_REWARDS_AIRDROP"] =
      toNumber(ledger.dailyRewards?.dailyRewardsAirdrop);
    rewardBreakdownByType["DAILY_REWARDS_BOOST"] =
      toNumber(ledger.dailyRewards?.dailyRewardsBoost);
      rewardBreakdownByType["DAILY_REWARDS_LP"] =
      toNumber(ledger.dailyRewards?.dailyRewardsLp);

    rewardBreakdownByType["XPOWER"] =
      toNumber(ledger.dailyRewards?.xPowerRewards);

    rewardBreakdownByType["XPOWER_TOTAL"] =
      toNumber(ledger.limits.xPowerLimit?.used);

    rewardBreakdownByType["cascade"] =
      toNumber(ledger.dailyRewards?.dailyCascadeRewards);

    rewardBreakdownByType["COMMUNITY_BOOSTER"] =
      toNumber(ledger.dailyRewards?.communityBoosterRewards);

    rewardBreakdownByType["XBONUS"] =
      toNumber(ledger.dailyRewards?.x1Rewards);
    rewardBreakdownByType["X_BONUS_REWARD"] =
      toNumber(ledger.limits.xBonusLimit?.used);

    /* ================== FORMAT ALL ================== */
    Object.keys(rewardBreakdownByType).forEach((k) => {
      rewardBreakdownByType[k] = rewardBreakdownByType[k].toFixed(6);
    });

    /* ================== FINAL RESPONSE ================== */
    const ledgerDetails = {
      daily_rewards: rewardBreakdownByType,

      swiftWallet: {
        balance: ledger.wallets.swift?.toString() || "0.0",
      },

      lpWallet: {
        limit: ledger.limits.lpLimit?.cap?.toString() || "0.0",
        used: ledger.limits.lpLimit?.used?.toString() || "0.0",
        balance: rawLpBalance,
        pending: ledger.wallets.lpPending?.toString() || "0.0",
        autopositioning: ledger.wallets.autopositionting?.toString() || "0.0",
      },

      usdtWallet: {
        balance: rawUsdtBalance,
      },

      boostWallet: {
        limit: ledger.limits.boostLimit?.cap?.toString() || "0.0",
        used: ledger.limits.boostLimit?.used?.toString() || "0.0",
        balance: ledger.wallets.boost?.toString() || "0.0",
      },

      airdropWallet: {
        limit: ledger.limits.airdropLimit?.cap?.toString() || "0.0",
        used: ledger.limits.airdropLimit?.used?.toString() || "0.0",
        balance: ledger.wallets.boost?.toString() || "0.0",
      },
      zeroRisk: {
        balance: rawZeroRisk,
      },

      communityRewards: {
        balance: ledger.wallets.communityRewards?.toString() || "0.0",
      },

      fiveXLimit: {
        cap: fiveXLimitCap.toString(),
        used: ledger.limits.fiveXLimit?.used?.toString() || "0.0",
      },

      totalRewardsWithdrawal:
        ledger.totalRewardsWithdrawal?.toString() || "0.0",

      cascadeRewards:
        ledger.limits.cascadeLimit?.used?.toString() || "0.0",

      dailyCascadeRewards:
        ledger.dailyRewards?.dailyCascadeRewards?.toString() || "0.0",

      communityBoosterBonus:
        ledger.limits.boosterLimit?.used?.toString() || "0.0",
       xBonus:  ledger.limits.xBonusLimit?.used?.toString() || "0.0",
    };

    return res.status(200).json({
      success: true,
      data: ledgerDetails,
    });
  } catch (error) {
    console.error("Error fetching ledger details:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching ledger details.",
    });
  }
};



function getSponsorBonusPctUTC(sponsorFirstLpDate) {
  if (!sponsorFirstLpDate) return 0;

  const ts = new Date(sponsorFirstLpDate).getTime();
  if (!Number.isFinite(ts)) return 0;

  const cutoffTs = Date.parse("2025-08-08T00:00:00Z");
  const hours = (Date.now() - ts) / 36e5; // ms -> hours

  // New schedule (sponsor AFTER cutoff): 8d, 7d, 7d, 8d
  if (ts > cutoffTs) {
    if (hours <= 8 * 24) return 0.5;   // up to day 8
    if (hours <= 15 * 24) return 0.3;  // day 9–15
    if (hours <= 22 * 24) return 0.2;  // day 16–22
    if (hours <= 30 * 24) return 0.1;  // day 23–30
    return 0;
  }

  // Legacy schedule (ON/BEFORE cutoff): 2d, 7d, 7d, 7d, 7d (total 30d)
  if (hours <= 2 * 24) return 0.5;     // up to day 2
  if (hours <= 9 * 24) return 0.3;     // day 3–9
  if (hours <= 16 * 24) return 0.2;    // day 10–16
  if (hours <= 23 * 24) return 0.1;    // day 17–23
  if (hours <= 30 * 24) return 0.05;   // day 24–30
  return 0;
}

// Core autopositioning logic
// Core autopositioning logic (cron) — aligned with addLpFromCommuntityRewards
const runAutopositioningForUser = async (user) => {
  const userId = user?._id;
  let ecosystemFee = false;
  let ecosystemFeeDeduction = ensureDecimal128("0.0");
  let boostBonusEntry = null;

  console.log(`🔄 [runAutopositioningForUser] Starting for user: ${user?.username} (${userId})`);

  try {
    if (!user) {
      console.log("❌ User not found");
      return;
    }

    const ledger = await getOrCreateLedger(userId);
    console.log("📒 Ledger fetched or created");

    // ---- compute gross, fee, net (no mutations yet)
    const grossCR = ensureDecimal128(ledger.wallets.communityRewards?.toString() || "0.0");
    console.log(`💰 COMMUNITY_REWARDS balance: ${grossCR.toString()}`);

   if (
    !grossCR ||
    isNaN(parseFloat(grossCR.toString())) ||
    compareDecimal128(grossCR, "0.0") <= 0
    ) {
    console.log("⚠️ Skipping autopositioning: No valid COMMUNITY_REWARDS balance or balance ≤ 0.");
    return;
    }

    const { totalDeposits, totalWithdrawals } = await getUserChainTotals(userId);
    const feeApplies = compareDecimal128(totalWithdrawals, totalDeposits) >= 0;

    if (feeApplies) {
      ecosystemFee = true;
      ecosystemFeeDeduction = roundTo6Decimal128(multiplyDecimal128(grossCR, "0.10"));
    }

    const netToLP = subtractDecimal128(grossCR, ecosystemFeeDeduction);
// 🔥 If 10% eco-fee charged → credit same amount to ZERO_RISK wallet
if (ecosystemFee && compareDecimal128(ecosystemFeeDeduction, "0.0") > 0) {
  const originalZeroRisk = ledger.wallets.zeroRisk;
  ledger.wallets.zeroRisk = addDecimal128(
    ledger.wallets.zeroRisk || "0.0",
    netToLP
  );
  console.log(`🛡 ZERO_RISK wallet updated: ${originalZeroRisk} → ${ledger.wallets.zeroRisk}`);
}

    // ---- apply wallet mutations in consistent order
    // 1) Deduct GROSS from COMMUNITY_REWARDS
    ledger.wallets.communityRewards = subtractDecimal128(ledger.wallets.communityRewards, grossCR);

    // 2) Credit NET to LP (🚫 do not credit ZERO_RISK here)
    const wasFirstDeposit = (user.counters.selfLp || "0.0").toString() === "0.0";
    user.counters.selfLp = addDecimal128(user.counters.selfLp || "0.0", netToLP);

    if (wasFirstDeposit) {
      user.firstLpDepositTs = new Date();
      console.log("🕒 First LP deposit timestamp set:", user.firstLpDepositTs);
    }

    const originalLp = ledger.wallets.lp;
    ledger.wallets.lp = addDecimal128(ledger.wallets.lp, netToLP);
    console.log(`💼 LP wallet updated: ${originalLp} -> ${ledger.wallets.lp}`);

    // 3) Limits based on NET
    const originalBoostCap = ledger.limits.boostLimit?.cap;
    ledger.limits.boostLimit.cap = addDecimal128(ledger.limits.boostLimit.cap || "0.0", netToLP);
    ledger.limits.fiveXLimit.cap = multiplyDecimal128(ledger.wallets.lp, "5");
    console.log(`🔁 Boost cap: ${originalBoostCap} → ${ledger.limits.boostLimit.cap}`);

    // ---- Sponsor bonus (base on NET)
    if (user.sponsorId) {
      console.log(`🔗 Sponsor found: ${user.sponsorId}`);
      const sponsor = await User.findById(user.sponsorId);

      if (!sponsor) {
        console.log("⚠️ Sponsor not found in DB.");
      } else {
        const sponsorLedger = await getOrCreateLedger(sponsor._id);

        if (!sponsor.firstLpDepositTs) {
          const sponsorLpBalance =
            sponsorLedger.wallets.lp || mongoose.Types.Decimal128.fromString("0.0");
          if (compareDecimal128(sponsorLpBalance, "0.0") > 0) {
            sponsor.firstLpDepositTs = new Date();
            await sponsor.save();
            console.log(`⏱️ Retroactively set sponsor LP timestamp: ${sponsor.firstLpDepositTs}`);
          }
        }

        if (sponsor.firstLpDepositTs) {
          const sponsorFirstLpTime = new Date(sponsor.firstLpDepositTs).getTime();
          const hoursDifference = (Date.now() - sponsorFirstLpTime) / (1000 * 60 * 60);

          let bonusPercentage = 0;
          // if (hoursDifference <= 24+168) bonusPercentage = 0.5;
          // else if (hoursDifference <= 24 + 168 * 2) bonusPercentage = 0.3;
          // else if (hoursDifference <= 24 + 168 * 3) bonusPercentage = 0.2;
          // else if (hoursDifference <= 24 + 168 * 4) bonusPercentage = 0.1;
          bonusPercentage =  getSponsorBonusPctUTC(sponsor.firstLpDepositTs);
          console.log(bonusPercentage,"===================bonusPercentage=====================");

          if (bonusPercentage > 0) {
            const bonusAmount = multiplyDecimal128(netToLP, bonusPercentage.toString());
            const sponsorBoostWalletBalance = ensureDecimal128(sponsorLedger.wallets.boost);
            const sponsorBoostLimitCap = ensureDecimal128(sponsorLedger.limits.boostLimit.cap);
            const availableBoostCapacity = subtractDecimal128(
              sponsorBoostLimitCap,
              sponsorBoostWalletBalance
            );

            if (compareDecimal128(availableBoostCapacity, "0.0") > 0) {
              const actualBonusToCredit = minDecimal128(bonusAmount, availableBoostCapacity);
              if (compareDecimal128(actualBonusToCredit, "0.0") > 0) {
                sponsorLedger.wallets.boost = addDecimal128(
                  sponsorLedger.wallets.boost,
                  actualBonusToCredit
                );
                await sponsorLedger.save();

                boostBonusEntry = await createLedgerEntry({


                  userId: sponsor._id,
                  eventType: "BOOST_BONUS",
                  amount: actualBonusToCredit.toString(),
                  walletFrom: "SYSTEM",
                  walletTo: "BOOST",
                  narrative: `Boost bonus (${bonusPercentage * 100}%) from referral ${user.username}.`,
                  refId: user._id.toString(),
                });

                console.log("🎁 Boost bonus credited:", actualBonusToCredit.toString());
              }
            }
          }
        }
      }
    }

    await user.save();
    await ledger.save();
    console.log("✅ User and ledger saved.");

    // ---- Ledger row: write AUTOPOSITIONING with GROSS so history matches deduction
    const lpDepositLedgerEntry = await createLedgerEntry({
      userId: userId,
      eventType: "AUTOPOSITIONING",
      amount: grossCR.toString(), // GROSS
      walletFrom: "COMMUNITY_REWARDS",
      walletTo: "LP",
      narrative: ecosystemFee
        ? `Auto-positioned ${grossCR} CR → LP. Credited ${netToLP}. Fee ${ecosystemFeeDeduction} (10%).`
        : `Auto-positioned ${grossCR} CR → LP. No fee.`,
    });
    console.log("🧾 Created AUTOPOSITIONING ledger entry");

    // ---- Record + settle the fee (chain)
    if (ecosystemFee && compareDecimal128(ecosystemFeeDeduction, "0.0") > 0) {
      let EcosystemFeeEntry = await EcosystemFee.create({
        userId,
        amount: ecosystemFeeDeduction,
        walletFrom: "COMMUNITY_REWARDS",
        ledgerRefId: lpDepositLedgerEntry._id.toString(),
        narrative: "10% ecosystem fee charged during autopositioning",
      });

    //  const txResult =  await sendUsdt({
    //         idempotency_key: lpDepositLedgerEntry._id,
    //         withdrawal_id: EcosystemFeeEntry._id,
    //         amount: ecosystemFeeDeduction,
    //         destination: process.env.ECOSYSTEM_ADDRESS,
    //       });

  
    //   if (txResult?.quicknode?.tx_json?.hash) {
    //     EcosystemFeeEntry.refId = txResult?.quicknode?.tx_json?.hash;
    //   }
      await EcosystemFeeEntry.save();
      console.log("🏛️ Ecosystem fee recorded and chain debit attempted.");
    }

    if (boostBonusEntry) {
      await LedgerRow.updateOne(
        { _id: boostBonusEntry._id },
        { $set: { refId: lpDepositLedgerEntry._id.toString() } }
      );
      console.log("🔗 BOOST_BONUS refId updated");
    }

    // ---- Upline team LP (non-blocking) using NET
    updateUplineTeamLp(user.uhid, netToLP).catch((err) =>
      console.error("🧱 Team LP update failed:", err)
    );

    console.log(`✅ Autopositioning completed successfully for ${user.username}`);
  } catch (error) {
    console.error(`❌ Error in runAutopositioningForUser: ${error.message}`, error);
  }
};


// Cron scheduler (runs every day at 12:05 AM UTC)
const startAutoPositioningCron = () => {
  cron.schedule(
    "0 5 * * *", // ⏰ Runs at 12:05 AM UTC
    async () => {
      const now = new Date().toISOString();
      console.log(`🚀 [CRON @ ${now}] AutoPositioning job started`);

      try {
        const users = await User.find({ autopositioning: true });
        console.log(
          `📋 Found ${users.length} users with autopositioning enabled`
        );

        for (const user of users) {
          console.log(
            `⚙️ Running autopositioning for: ${user.username} (${user._id})`
          );
          await runAutopositioningForUser(user);
        }

        console.log("✅ [CRON] AutoPositioning job completed.");
      } catch (err) {
        console.error(
          "❌ [CRON] Error during autopositioning cron:",
          err.message
        );
      }
    },
    {
      timezone: "Etc/UTC", // 👈 Forces UTC time regardless of server location
    }
  );

  console.log("🕓 AutoPositioning Cron scheduled for 12:05 AM UTC daily");
};

// Get ledger history for authenticated user
const getLedgerHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { eventType, page = 1, limit = 20, startDate, endDate } = req.query;

    let query = { userId };

    // Filter by event type if specified
    if (eventType && eventType !== "all") {
      query.eventType = eventType;
    }

    // Date range filter
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
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const totalEntries = await LedgerRow.countDocuments(query);
    const totalPages = Math.ceil(totalEntries / limitNum);

    // Fetch paginated entries
    const entries = await LedgerRow.find(query)
      .sort({ ts: -1 })
      .select("ts eventType walletFrom walletTo amount ratePct narrative refId")
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.json({
      success: true,
      entries: entries.map((entry) => ({
        ...entry,
        amount: parseFloat(entry.amount).toFixed(6),
        ratePct: entry.ratePct ? parseFloat(entry.ratePct).toFixed(2) : null,
        narrative: entry.narrative || "",
        refId: entry.refId || "",
      })),
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
    console.error("Error fetching ledger history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ledger history",
    });
  }
};



const walletHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    let totals;
    let runningBalanceUSDT = 0;
    let runningBalanceLP = 0;

    const {
      eventType,
      page = 1,
      limit = 20,
      startDate,
      endDate,
      wallet,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    /* -------------------- DATE FILTER -------------------- */
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        dateFilter.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.ts.$lte = end;
      }
    }

    /* -------------------- MAIN QUERY -------------------- */
    let mainQuery = {
      userId,
      ...dateFilter,
      ...(eventType && eventType !== "all" ? { eventType } : {}),
      ...(wallet === "REWARDS"
        ? { walletFrom: "COMMUNITY_REWARDS" }
        : wallet
        ? { $or: [{ walletFrom: wallet }, { walletTo: wallet }] }
        : {}),
    };

    const rawEntries = await LedgerRow.find(mainQuery)
      .select("ts eventType walletFrom walletTo amount ratePct narrative refId")
      .sort({ ts: 1 })
      .lean();

    console.log(
      `🔍 Found ${rawEntries.length} raw ledger entries for user ${userId} and wallet ${wallet}`
    );

    /* -------------------- VARIABLES -------------------- */
    let runningBalance = 0;
    let skipZeroRisk = false;
    const enrichedEntries = [];

    let totalDeposits = 0;
    let totalLpositioning = 0;
    let totalWithdrawals = 0;
    let totalRewards = 0;
    let totalRedeemed = 0;
    let totalPositioned = 0;
    let runningBalanceCR = 0;

    const rawIds = rawEntries.map(e => e._id.toString());

      // Fetch ecosystem fees linked to these ledger rows
      const ecoFees = await EcosystemFee.find({ ledgerRefId: { $in: rawIds } })
        .lean();

      const ecoFeeMap = {};
      for (const fee of ecoFees) {
        const ref = fee.ledgerRefId.toString();
        if (!ecoFeeMap[ref]) ecoFeeMap[ref] = [];
        ecoFeeMap[ref].push(fee);
      }


    /* -------------------- PROCESS ENTRIES -------------------- */
    for (const entry of rawEntries) {
      const amount = parseFloat(entry.amount);
      const isZeroRiskWithdrawal =
        entry.eventType === "WITHDRAWAL" && entry.walletFrom === "ZERO_RISK";
      const isRedeemed = entry.eventType === "REWARDS_REDEEMED";
      const isAutoPositioned = entry.eventType === "AUTOPOSITIONING";
      const isClaimed = entry.eventType === "CLAIMED";

      if (wallet === "COMMUNITY_REWARDS" && isClaimed) {
        console.log(
          `⏩ Skipping CLAIMED event for COMMUNITY_REWARDS on ${entry.ts}`
        );
        continue;
      }

      const previousBalance = runningBalance;
      let isDeposit = false;

      /* -------------------- USDT -------------------- */
      if (wallet === "USDT") {
        const isDepositToUsdt =
          entry.eventType === "DEPOSIT" && entry.walletTo === "USDT";

        const isDebitToExternal =
          (entry.eventType === "WITHDRAWAL" || entry.eventType === "CLAIMED") &&
          entry.walletFrom === "USDT" &&
          entry.walletTo === "EXTERNAL";

        if (isDepositToUsdt) runningBalance += amount;
        else if (isDebitToExternal) runningBalance -= amount;

        if (runningBalance < 0) runningBalance = 0;

        if (isDepositToUsdt) totalDeposits += amount;
        if (isDebitToExternal) totalWithdrawals += amount;

        if (entry.walletFrom === "USDT" && entry.walletTo === "LP") {
          totalLpositioning += amount;
        }
      }

      /* -------------------- LP -------------------- */
      else if (wallet === "LP") {
        isDeposit = entry.walletTo === "LP";
      }

      /* -------------------- COMMUNITY_REWARDS -------------------- */
      if (wallet === "COMMUNITY_REWARDS") {
        if (isClaimed) continue;

        const prev = runningBalanceCR;

        if (entry.walletTo === "COMMUNITY_REWARDS") {
          runningBalanceCR += amount;
        } else if (entry.walletFrom === "COMMUNITY_REWARDS") {
          runningBalanceCR -= amount;
          if (runningBalanceCR < 0) runningBalanceCR = 0;

          if (isRedeemed) totalRedeemed += amount;
          else if (isAutoPositioned) totalPositioned += amount;
        }

        enrichedEntries.push({
          ...entry,
          amount: amount.toFixed(6),
          ratePct: entry.ratePct ? parseFloat(entry.ratePct).toFixed(2) : null,
          narrative: entry.narrative || "",
          refId: entry.refId || "",
          previousBalance: prev.toFixed(6),
          available_balance: runningBalanceCR.toFixed(6),
        });
        continue;
      }

      /* -------------------- REWARDS (only debits from COMMUNITY_REWARDS) -------------------- */
 if (wallet === "REWARDS") {
  // If ecosystem fee exists for this ledgerRow, push it just after
const ecoLinked = ecoFeeMap[entry._id.toString()];
if (ecoLinked && ecoLinked.length > 0) {
  for (const fee of ecoLinked) {
    enrichedEntries.push({
      ...fee,
      amount: parseFloat(fee.amount).toFixed(6),
      previousBalance: null,
      available_balance: null,
      narrative: fee.narrative || "Ecosystem fee",
      eventType: "ECOSYSTEM_FEE",
      ecosystemLinked: true,
    });
    console.log(`💸 Added ecosystem fee after LedgerRow ${entry._id}`);
  }
}
  const prev = runningBalanceCR;
  // Skip deposits (we only want debits)
  if (entry.eventType === "DEPOSIT") {
    console.log(`⏩ Skipping DEPOSIT event for REWARDS on ${entry.ts}`);
    continue;
  }
  // every record is a debit from COMMUNITY_REWARDS
  runningBalanceCR -= amount;
  if (runningBalanceCR < 0) runningBalanceCR = 0;

  if (entry.eventType === "REWARDS_REDEEMED") {
    totalRedeemed += amount;
    console.log(`🔻 REWARD Redeemed: -${amount}, New Balance: ${runningBalanceCR}`);
  } else if (entry.eventType === "AUTOPOSITIONING") {
    totalPositioned += amount;
    console.log(`📤 REWARD AutoPositioning: -${amount}, New Balance: ${runningBalanceCR}`);
  }  else if (entry.eventType === "AUTO_DEBIT") {
    totalPositioned += amount;
    console.log(`📤 REWARD AUTO DEBIT: -${amount}, New Balance: ${runningBalanceCR}`);
  }else {
    console.log(`📉 REWARD Other debit: -${amount}, New Balance: ${runningBalanceCR}`);
  }

  enrichedEntries.push({
    ...entry,
    amount: amount.toFixed(6),
    ratePct: entry.ratePct ? parseFloat(entry.ratePct).toFixed(2) : null,
    narrative: entry.narrative || "",
    refId: entry.refId || "",
    previousBalance: prev.toFixed(6),
    available_balance: runningBalanceCR.toFixed(6),
  });

  continue; // skip default handling
}


      /* -------------------- DEFAULT ENTRIES -------------------- */
      enrichedEntries.push({
        ...entry,
        amount: amount.toFixed(6),
        ratePct: entry.ratePct ? parseFloat(entry.ratePct).toFixed(2) : null,
        narrative: entry.narrative || "",
        refId: entry.refId || "",
        previousBalance: previousBalance.toFixed(6),
        available_balance: runningBalance.toFixed(6),
      });

      /* -------------------- Totals for LP -------------------- */
      if (wallet === "LP") {
        if (entry.walletFrom === "COMMUNITY_REWARDS" && entry.walletTo === "LP")
          totalRewards += amount;
        if (entry.walletFrom === "USDT" && entry.walletTo === "LP")
          totalLpositioning += amount;
        if (
          (entry.eventType === "WITHDRAWAL" || entry.eventType === "CLAIMED") &&
          (entry.walletFrom === "LP" || entry.walletFrom === "ZERO_RISK")
        )
          totalWithdrawals += amount;
      }
    }

    /* -------------------- PAGINATION -------------------- */
    const sorted = enrichedEntries.sort(
      (a, b) => new Date(b.ts) - new Date(a.ts)
    );
    const paginated = sorted.slice(skip, skip + limitNum);

    /* -------------------- TOTALS -------------------- */
    if (wallet === "USDT") {
      totals = {
        totalDeposits: totalDeposits.toFixed(6),
        totalLpositioning: totalLpositioning.toFixed(6),
        totalWithdrawals: totalWithdrawals.toFixed(6),
      };
    } else if (wallet === "LP") {
      totals = {
        totalrewards: totalRewards.toFixed(6),
        totalLpositioning: totalLpositioning.toFixed(6),
        totalWithdrawals: totalWithdrawals.toFixed(6),
      };
    } else if (wallet === "COMMUNITY_REWARDS") {
      totals = {
        currentAvailable: runningBalanceCR.toFixed(6),
        totalLpositioning: totalPositioned.toFixed(6),
        totalRedeemed: totalRedeemed.toFixed(6),
      };
    } else if (wallet === "REWARDS") {
      totals = {
        currentAvailable: runningBalanceCR.toFixed(6),
        totalRedeemed: totalRedeemed.toFixed(6),
        totalLpositioning: totalPositioned.toFixed(6),
      };
    }

    return res.json({
      success: true,
      entries: paginated,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(enrichedEntries.length / limitNum),
        totalEntries: enrichedEntries.length,
        hasNextPage: pageNum * limitNum < enrichedEntries.length,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
      totals,
    });
  } catch (error) {
    console.error("❌ Error fetching wallet history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallet history",
    });
  }
};


const reports = async (req, res) => {
  try {
    const {
      eventType,
      page = 1,
      limit = 20,
      startDate,
      endDate,
      wallet,
      search,
    } = req.query;

    const walletList = [
      "AIRDROP",
      "BOOST",
      "COMMUNITY_REWARDS",
      "LP",
      "SWIFT",
      "USDT",
      "ZERO_RISK",
      "AUTOPOSITIONING",
    ];

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    let match = {};
    let matchedUserIds = [];

    // 🔍 Search filter by username or uhid
    if (search && search.trim()) {
      const keywords = search.trim().split(/\s+/);
      const regexes = keywords.map((k) => new RegExp(k, "i"));

      const matchedUsers = await User.find(
        {
          $or: regexes.flatMap((regex) => [
            { username: regex },
            { uhid: regex },
          ]),
        },
        { _id: 1 }
      );

      matchedUserIds = matchedUsers.map((u) => u._id.toString());

      console.log("🔍 Matched User IDs for search:", matchedUserIds);

      if (matchedUserIds.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: {
            currentPage: 1,
            totalPages: 0,
            totalEntries: 0,
            hasNextPage: false,
            hasPrevPage: false,
            limit: limitNum,
          },
        });
      }

      match.userId = { $in: matchedUserIds };
    }

    if (eventType && eventType !== "all") {
      match.eventType = eventType;
    }

    if (wallet) {
      match.$or = [{ walletFrom: wallet }, { walletTo: wallet }];
    }

    if (startDate || endDate) {
      match.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        match.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        match.ts.$lte = end;
      }
    }

    console.log(
      "🧾 Final MongoDB match query:",
      JSON.stringify(match, null, 2)
    );

    const ledgerRows = await LedgerRow.find(match).sort({ ts: 1 });

    const userMap = {};

    for (const record of ledgerRows) {
      const {
        userId,
        eventType,
        walletFrom,
        walletTo,
        amount: rawAmount,
      } = record;

      const uid = userId.toString();
      const amount = parseFloat(rawAmount.toString());

      if (!userMap[uid]) {
        const walletStats = {};
        for (const w of walletList) {
          walletStats[w] = {
            wallet: w,
            openingBalance: 0,
            totalCredits: 0,
            totalWithdrawals: 0,
            closingBalance: 0,
            history: [],
          };
        }

        userMap[uid] = {
          userId: uid,
          wallets: walletStats,
          summary: {
            REDEEMED: { total: 0, entries: [] },
            CLAIM: { total: 0, entries: [] },
          },
        };
      }

      const { wallets, summary } = userMap[uid];
      let wallet = null;
      let type = null;
      let historyEntry = null;

      if (
        [
          "DAILY_REWARDS_AIRDROP",
          "DAILY_REWARDS_BOOST",
          "DAILY_REWARDS_LP",
        ].includes(eventType)
      ) {
        wallet = "COMMUNITY_REWARDS";
        type = "DEPOSIT";
        historyEntry = { eventType, amount, source: "SYSTEM" };
      } else if (eventType === "REWARDS_REDEEMED") {
        wallet = "COMMUNITY_REWARDS";
        type = "WITHDRAWAL";
        historyEntry = { eventType, amount, target: "USER" };
      } else if (eventType === "BOOST_BONUS") {
        wallet = "BOOST";
        type = "DEPOSIT";
        historyEntry = { eventType, amount, source: "SYSTEM" };
      } else if (eventType === "LP_DEPOSIT_FROM_USDT") {
        wallets["LP"].totalCredits += amount;
        wallets["LP"].history.push({ eventType, amount, source: "USDT" });

        wallets["USDT"].totalWithdrawals += amount;
        wallets["USDT"].history.push({ eventType, amount, target: "LP" });
        continue;
      } else if (eventType === "SWIFT_TRANSFER_IN") {
        wallet = "SWIFT";
        type = "DEPOSIT";
        historyEntry = { eventType, amount, source: "USER" };
      } else if (eventType === "AUTOPOSITIONING") {
        wallet = "AUTOPOSITIONING";
        type = "DEPOSIT";
        historyEntry = { eventType, amount, source: "COMMUNITY_REWARDS" };
      } else if (eventType === "SWIFT_TRANSFER_OUT") {
        wallet = "SWIFT";
        type = "WITHDRAWAL";
        historyEntry = { eventType, amount, target: "EXTERNAL" };
      } else if (eventType === "DEPOSIT") {
        wallet =
          walletFrom === "EXTERNAL" || walletFrom === "INTERNAL"
            ? walletTo
            : walletFrom;
        type = "DEPOSIT";
        historyEntry = { eventType, amount, source: walletFrom };

        if (wallet === "USDT") {
          wallets["ZERO_RISK"].totalCredits += amount;
          wallets["ZERO_RISK"].history.push({
            eventType: "MIRRORED_DEPOSIT_FROM_USDT",
            amount: amount.toFixed(6),
            source: "USDT",
          });
        }
      } else if (eventType === "WITHDRAWAL") {
        wallet =
          walletTo === "EXTERNAL" || walletTo === "INTERNAL"
            ? walletFrom
            : walletTo;
        type = "WITHDRAWAL";
        historyEntry = { eventType, amount, target: walletTo };
      }

      if (wallet && wallets[wallet]) {
        if (type === "DEPOSIT") wallets[wallet].totalCredits += amount;
        if (type === "WITHDRAWAL") wallets[wallet].totalWithdrawals += amount;

        if (historyEntry) {
          historyEntry.amount = amount.toFixed(6);
          wallets[wallet].history.push(historyEntry);
        }
      }

      if (eventType === "REWARDS_REDEEMED") {
        summary.REDEEMED.total += amount;
        summary.REDEEMED.entries.push({
          eventType,
          amount: amount.toFixed(6),
          target: "COMMUNITY_REWARDS",
        });
      }

      if (eventType === "WITHDRAWAL") {
        summary.CLAIM.total += amount;
        summary.CLAIM.entries.push({
          eventType,
          amount: amount.toFixed(6),
          target: walletTo,
        });
      }
    }

    let allUserResults = [];

    for (const user of Object.values(userMap)) {
      for (const wallet of walletList) {
        const stats = user.wallets[wallet];
        stats.closingBalance =
          stats.openingBalance + stats.totalCredits - stats.totalWithdrawals;

        stats.openingBalance = stats.openingBalance.toFixed(6);
        stats.totalCredits = stats.totalCredits.toFixed(6);
        stats.totalWithdrawals = stats.totalWithdrawals.toFixed(6);
        stats.closingBalance = stats.closingBalance.toFixed(6);
      }

      user.summary.REDEEMED.total = user.summary.REDEEMED.total.toFixed(6);
      user.summary.CLAIM.total = user.summary.CLAIM.total.toFixed(6);

      allUserResults.push({
        userId: user.userId,
        wallets: walletList.map((w) => user.wallets[w]),
        summary: user.summary,
      });
    }

    // 🔒 Filter to only matched users if search was used
    if (search && matchedUserIds.length > 0) {
      allUserResults = allUserResults.filter((entry) =>
        matchedUserIds.includes(entry.userId)
      );
    }

    const userIds = allUserResults.map((u) => u.userId);

    const users = await User.find(
      { _id: { $in: userIds } },
      { username: 1, uhid: 1 }
    );

    const userDetailsMap = {};
    users.forEach((u) => {
      userDetailsMap[u._id.toString()] = {
        username: u.username || "",
        uhid: u.uhid || "",
      };
    });

    allUserResults.forEach((entry) => {
      const info = userDetailsMap[entry.userId] || {};
      entry.username = info.username || "N/A";
      entry.uhid = info.uhid || "N/A";
    });

    const ledgers = await Ledger.find({ userId: { $in: userIds } });

    const ledgerMap = {};
    ledgers.forEach((l) => {
      ledgerMap[l.userId.toString()] = l.toObject();
    });

    allUserResults.forEach((entry) => {
      const ledger = ledgerMap[entry.userId] || null;
      entry.ledgerDetails = ledger;
    });

    const totalEntries = allUserResults.length;
    const totalPages = Math.ceil(totalEntries / limitNum);

    res.json({
      success: true,
      data: allUserResults.slice(skip, skip + limitNum),
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
    console.error("❌ Error generating wallet report:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate report",
    });
  }
};

const usersReports = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      eventType,
      page = 1,
      limit = 20,
      startDate,
      endDate,
      wallet,
    } = req.query;

    const walletList = [
      "AIRDROP",
      "BOOST",
      "COMMUNITY_REWARDS",
      "LP",
      "SWIFT",
      "USDT",
      "ZERO_RISK",
      "AUTOPOSITIONING",
    ];

    let match = { userId: new mongoose.Types.ObjectId(userId) };

    if (eventType && eventType !== "all") {
      match.eventType = eventType;
    }

    if (wallet) {
      match.$or = [{ walletFrom: wallet }, { walletTo: wallet }];
    }

    if (startDate || endDate) {
      match.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        match.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        match.ts.$lte = end;
      }
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // STEP 1: Group by date and event info
    const groupedData = await LedgerRow.aggregate([
      { $match: match },
      {
        $addFields: {
          date: {
            $dateToString: { format: "%Y-%m-%d", date: "$ts" },
          },
        },
      },
      {
        $group: {
          _id: {
            date: "$date",
            eventType: "$eventType",
            walletFrom: "$walletFrom",
            walletTo: "$walletTo",
            narrative: "$narrative",
          },
          totalAmount: { $sum: { $toDecimal: "$amount" } },
        },
      },
      {
        $group: {
          _id: "$_id.date",
          records: {
            $push: {
              eventType: "$_id.eventType",
              walletFrom: "$_id.walletFrom",
              walletTo: "$_id.walletTo",
              totalAmount: "$totalAmount",
              narrative: "$narrative",
            },
          },
        },
      },
      { $sort: { _id: 1 } }, // Oldest to newest
    ]);

    const totalDays = groupedData.length;
    const totalPages = Math.ceil(totalDays / limitNum);

    const runningBalances = {};
    walletList.forEach((w) => (runningBalances[w] = 0));

    const allDayResults = [];

    for (const day of groupedData) {
      const date = day._id;
      const walletStats = {};
      const summary = {
        REDEEMED: {
          total: 0,
          entries: [],
        },
        CLAIM: {
          total: 0,
          entries: [],
        },
      };
      for (const wallet of walletList) {
        walletStats[wallet] = {
          wallet,
          openingBalance: runningBalances[wallet],
          totalCredits: 0,
          totalWithdrawals: 0,
          closingBalance: 0,
          history: [],
        };
      }

      for (const record of day.records) {
        console.log(record, "recordssssss");
        const { eventType, walletFrom, walletTo, totalAmount } = record;
        const amount = parseFloat(totalAmount.toString());

        let wallet = null;
        let type = null;
        let historyEntry = null;

        // 🧠 Custom Mapping Logic
        if (
          [
            "DAILY_REWARDS_AIRDROP",
            "DAILY_REWARDS_BOOST",
            "DAILY_REWARDS_LP",
          ].includes(eventType)
        ) {
          wallet = "COMMUNITY_REWARDS";
          type = "DEPOSIT";
          historyEntry = { eventType, amount, source: "SYSTEM" };
        } else if (eventType === "REWARDS_REDEEMED") {
          wallet = "COMMUNITY_REWARDS";
          type = "WITHDRAWAL";
          historyEntry = { eventType, amount, target: "USER" };
        } else if (eventType === "BOOST_BONUS") {
          wallet = "BOOST";
          type = "DEPOSIT";
          historyEntry = { eventType, amount, source: "SYSTEM" };
        } else if (eventType === "LP_DEPOSIT_FROM_USDT") {
          if (walletList.includes("LP")) {
            walletStats["LP"].totalCredits += amount;
            walletStats["LP"].history.push({
              eventType,
              amount,
              source: "USDT",
            });
          }
          if (walletList.includes("USDT")) {
            walletStats["USDT"].totalWithdrawals += amount;
            walletStats["USDT"].history.push({
              eventType,
              amount,
              target: "LP",
            });
          }
          continue;
        } else if (eventType === "SWIFT_TRANSFER_IN") {
          wallet = "SWIFT";
          type = "DEPOSIT";
          historyEntry = { eventType, amount, source: "USER" };
        } else if (eventType === "SWIFT_TRANSFER_OUT") {
          wallet = "SWIFT";
          type = "WITHDRAWAL";
          historyEntry = { eventType, amount, target: "EXTERNAL" };
        } else if (eventType === "DEPOSIT") {
          wallet =
            walletFrom === "EXTERNAL" || walletFrom === "INTERNAL"
              ? walletTo
              : walletFrom;
          type = "DEPOSIT";
          historyEntry = { eventType, amount, source: walletFrom };

          // 🎯 Mirror deposit to ZERO_RISK when USDT is the recipient
          if (wallet === "USDT" && walletList.includes("ZERO_RISK")) {
            walletStats["ZERO_RISK"].totalCredits += amount;
            walletStats["ZERO_RISK"].history.push({
              eventType: "MIRRORED_DEPOSIT_FROM_USDT",
              amount: amount.toFixed(6),
              source: "USDT",
            });
          }
        } else if (eventType === "WITHDRAWAL") {
          wallet =
            walletTo === "EXTERNAL" || walletTo === "INTERNAL"
              ? walletFrom
              : walletTo;
          type = "WITHDRAWAL";
          historyEntry = { eventType, amount, target: walletTo };
        }

        if (wallet && walletList.includes(wallet)) {
          if (type === "DEPOSIT") {
            walletStats[wallet].totalCredits += amount;
          } else if (type === "WITHDRAWAL") {
            walletStats[wallet].totalWithdrawals += amount;
          }
          if (historyEntry) {
            historyEntry.amount = amount.toFixed(6);
            walletStats[wallet].history.push(historyEntry);
          }
        }
        if (eventType === "REWARDS_REDEEMED") {
          summary.REDEEMED.total += amount;
          summary.REDEEMED.entries.push({
            eventType,
            amount: amount.toFixed(6),
            target: "COMMUNITY_REWARDS",
          });
        }

        if (eventType === "WITHDRAWAL") {
          summary.CLAIM.total += amount;
          summary.CLAIM.entries.push({
            eventType,
            amount: amount.toFixed(6),
            target: walletTo,
          });
        }
      }
      for (const wallet of walletList) {
        const stats = walletStats[wallet];
        stats.closingBalance =
          stats.openingBalance + stats.totalCredits - stats.totalWithdrawals;

        // Update global running balance
        runningBalances[wallet] = stats.closingBalance;

        // Format values
        stats.openingBalance = stats.openingBalance.toFixed(6);
        stats.totalCredits = stats.totalCredits.toFixed(6);
        stats.totalWithdrawals = stats.totalWithdrawals.toFixed(6);
        stats.closingBalance = stats.closingBalance.toFixed(6);
      }
      // Format summary totals
      summary.REDEEMED.total = summary.REDEEMED.total.toFixed(6);
      summary.CLAIM.total = summary.CLAIM.total.toFixed(6);

      allDayResults.push({
        date,
        wallets: walletList.map((w) => walletStats[w]),
        summary,
      });
    }

    // STEP 2: Paginate descending (latest dates first)
    const paginatedDayResults = allDayResults
      .reverse()
      .slice(skip, skip + limitNum);

    res.json({
      success: true,
      data: paginatedDayResults,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalEntries: totalDays,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error generating wallet balance report:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate report",
    });
  }
};

const CommunityRewardsHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 500000, startDate, endDate } = req.query;
    const wallet = "COMMUNITY_REWARDS";
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    // Build date filter
    const match = {
      userId,
      $or: [{ walletFrom: wallet }, { walletTo: wallet }],
    };
    const now = new Date();
    let chainTxHash = null;
    if (startDate || endDate) {
      match.ts = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setUTCHours(0, 0, 0, 0);
        match.ts.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        match.ts.$lte = end;
      }
    } else {
      // Default: current month
      const firstOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const endOfMonth = new Date(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        0
      );
      endOfMonth.setUTCHours(23, 59, 59, 999);
      match.ts = {
        $gte: firstOfMonth,
        $lte: endOfMonth,
      };
    }
    const aggregationPipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$ts" },
            },
            eventType: "$eventType",
          },
          totalAmount: { $sum: { $toDouble: "$amount" } },
          details: {
            $push: {
              amount: { $toString: "$amount" },
              walletFrom: "$walletFrom",
              walletTo: "$walletTo",
              ts: "$ts",
              narrative: "$narrative",
              refId: "$refId",
            },
          },
        },
      },
      {
        $group: {
          _id: "$_id.date",
          eventTypeSums: {
            $push: {
              k: "$_id.eventType",
              v: { $round: ["$totalAmount", 6] },
            },
          },
          eventTypeDetails: {
            $push: {
              k: "$_id.eventType",
              v: "$details",
            },
          },
        },
      },
      {
        $addFields: {
          sums: { $arrayToObject: "$eventTypeSums" },
          details: { $arrayToObject: "$eventTypeDetails" },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          sums: 1,
          details: 1,
        },
      },
      { $sort: { date: 1 } }, // ascending for accurate balance calculation
    ];
    let entries = await LedgerRow.aggregate(aggregationPipeline);
    // Calculate running balances
    let runningBalance = 0;
    entries = entries.map((entry) => {
      let credits = 0;
      let debits = 0;
      for (const records of Object.values(entry.details)) {
        for (const tx of records) {
          const amt = parseFloat(tx.amount);
          if (tx.walletTo === wallet) {
            credits += amt;
          } else if (tx.walletFrom === wallet) {
            debits += amt;
          }
        }
      }
      const openingBalance = parseFloat(runningBalance.toFixed(6));
      const closingBalance = parseFloat(
        (runningBalance + credits - debits).toFixed(6)
      );
      runningBalance = closingBalance;
      return {
        ...entry,
        credits: parseFloat(credits.toFixed(6)),
        debits: parseFloat(debits.toFixed(6)),
        openingBalance,
        closingBalance,
      };
    });
    // Sort descending after computation
    entries = entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    const paginatedEntries = entries.slice(skip, skip + limitNum);
    res.json({
      success: true,
      entries: paginatedEntries,
      pagination: {
        currentPage: pageNum,
        hasNextPage: skip + limitNum < entries.length,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error("Error aggregating ledger history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ledger history",
    });
  }
};
// Get all distinct ledger event types
const getLedgerEventTypes = async (req, res) => {
  try {
    const eventTypes = await LedgerRow.distinct("eventType");
    res.status(200).json({
      success: true,
      data: eventTypes.sort(),
    });
  } catch (error) {
    console.error("Error fetching ledger event types:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching event types." });
  }
};

/* Get Onchain deposits and Withdrawals Starts Here */
const getUserChainTotals = async (userId) => {
  const baseFilter = { userId };

  const [depositSummary] = await ChainDeposit.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  const [withdrawalSummary] = await ChainWithdrawal.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  return {
    totalDeposits: depositSummary?.totalAmount || 0,
    totalWithdrawals: withdrawalSummary?.totalAmount || 0,
  };
};
/* Get Onchain deposits and Withdrawals Ends Here*/

// Add LP from CommuntityRewards wallet
const addLpFromCommuntityRewards = async (req, res) => {
  console.log("[addLpFromCommuntityRewards] Received request");
  console.log(req.user);
  const userId = req.user._id;
  console.log(userId);
  let ecosystemFee = false;
  let ecosystemFeeDeduction = null;
  console.log(req.query.deactivate, "req.query.deactivateeeeeeeeeeee");

  try {
    const user = await User.findById(userId);

    if (!user) {
      console.log("[addLpFromCommuntityRewards] Error: User not found.");
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (req.query.deactivate === "true") {
      user.autopositioning = false;
      await user.save();
      console.log(` Autopositioning deactivated for user: ${userId}`);

      return res.status(200).json({
        success: true,
        message: "Autopositioning deactivated.",
      });
    }

    user.autopositioning = true;
    await user.save();
    console.log(`[addLpFromCommuntityRewards] Found user: ${user.username}`);

    const ledger = await getOrCreateLedger(userId);
    console.log("[addLpFromCOMMUNITY_REWARDS] Fetched or created ledger.");

    let transferAmountD128 = ensureDecimal128(
      ledger.wallets.communityRewards?.toString() || "0.0"
    );
    console.log(
      `[addLpFromCOMMUNITY_REWARDS] COMMUNITY_REWARDS balance: ${transferAmountD128.toString()}`
    );

    if (compareDecimal128(transferAmountD128, "0.0") <= 0) {
      console.log(
        "[addLpFromCommunityRewards] No rewards to transfer, but marking autopositioning as successful."
      );
      return res.status(200).json({
        success: false,
        message: "Success! You have been successfully autopositioned.",
      });
    }

    console.log(
      "[addLpFromCommunityRewards] --- Starting Core Business Logic ---"
    );
    ledger.wallets.communityRewards = subtractDecimal128(
      ledger.wallets.communityRewards,
      transferAmountD128
    );
    const isFirstDeposit = (user.counters.selfLp || "0.0").toString() === "0.0";

    const { totalDeposits, totalWithdrawals } = await getUserChainTotals(
      userId
    );
    if (totalWithdrawals >= totalDeposits) {
      ecosystemFee = true;
      ecosystemFeeDeduction = roundTo6Decimal128(
        multiplyDecimal128(transferAmountD128, "0.10")
      );
      transferAmountD128 = subtractDecimal128(
        transferAmountD128,
        ecosystemFeeDeduction
      );

      ledger.wallets.zeroRisk = addDecimal128(
        ledger.wallets.zeroRisk,
        transferAmountD128
      );
      // Optional: attach these for tracking
      console.log("ecosystemFeeDeduction:", ecosystemFeeDeduction.toString());
      console.log(
        "Adjusted transferAmountD128:",
        transferAmountD128.toString()
      );
    }

    console.log(
      `[addLpFromcommunityRewards] Is first deposit? ${isFirstDeposit}`
    );
    user.counters.selfLp = addDecimal128(
      user.counters.selfLp || "0.0",
      transferAmountD128
    );

    if (isFirstDeposit) {
      user.firstLpDepositTs = new Date();
      console.log(
        `[addLpFromcommunityRewards] Set firstLpDepositTs for user ${user.username} to ${user.firstLpDepositTs}`
      );
    }
    const originalLp = ledger.wallets.lp;
    ledger.wallets.lp = addDecimal128(ledger.wallets.lp, transferAmountD128);
    console.log(
      `[addLpFromCommunityRewards] LP wallet updated: ${originalLp} -> ${ledger.wallets.lp}`
    );
    let boostBonusEntry = null;
    console.log("[addLpFromcommunityRewards] Updating limits...");
    const originalBoostCap = ledger.limits.boostLimit?.cap;
    const original5xCap = ledger.limits.fiveXLimit?.cap;
    let firstDepositDate = null;
// prefer firstLpDepositTs if available
if (user.firstLpDepositTs) {
  firstDepositDate = new Date(user.firstLpDepositTs);
} else {
  firstDepositDate = new Date();
}

if (firstDepositDate && !isNaN(firstDepositDate.getTime())) {
  const endDate = new Date(firstDepositDate);
  endDate.setDate(endDate.getDate() + 30);
  endDate.setHours(23, 59, 59, 999);

  if (new Date() <= endDate) {
    const originalBoostCap = ledger.limits.boostLimit?.cap;
    ledger.limits.boostLimit.cap = addDecimal128(
      ledger.limits.boostLimit.cap || "0.0",
      transferAmountD128
    );
    console.log(
      `[addLpFromUsdt] Boost limit cap updated (within 29 days): ${originalBoostCap} -> ${ledger.limits.boostLimit.cap}`
    );
  } else {
    console.log(
      `[addLpFromUsdt] Skipped boost limit update (after 29-day cutoff). FirstDepositTs=${firstDepositDate.toISOString()}`
    );
  }
} else {
  console.warn(
    `[addLpFromUsdt] No valid first deposit date found for user ${user.username}. Skipping boost limit update.`
  );
}

    ledger.limits.fiveXLimit.cap = multiplyDecimal128(ledger.wallets.lp, "5");

    if (user.sponsorId) {
      const sponsor = await User.findById(user.sponsorId);
      if (sponsor) {
        const sponsorLedger = await getOrCreateLedger(sponsor._id);
        if (!sponsor.firstLpDepositTs) {
          const sponsorLpBalance =
            sponsorLedger.wallets.lp ||
            mongoose.Types.Decimal128.fromString("0.0");
          if (compareDecimal128(sponsorLpBalance, "0.0") > 0) {
            sponsor.firstLpDepositTs = new Date();
            await sponsor.save();
          }
        }

        if (sponsor.firstLpDepositTs) {
          const sponsorFirstLpTime = new Date(
            sponsor.firstLpDepositTs
          ).getTime();
          const currentUserDepositTime = new Date().getTime();
          const hoursDifference =
            (currentUserDepositTime - sponsorFirstLpTime) / (1000 * 60 * 60);

          let bonusPercentage = 0;
          bonusPercentage =  getSponsorBonusPctUTC(sponsor.firstLpDepositTs);
            console.log(bonusPercentage,"===================bonusPercentage=====================");

          if (bonusPercentage > 0) {
            const bonusAmount = multiplyDecimal128(
              transferAmountD128,
              bonusPercentage.toString()
            );

            const sponsorBoostWalletBalance = ensureDecimal128(
              sponsorLedger.wallets.boost
            );
            const sponsorBoostLimitCap = ensureDecimal128(
              sponsorLedger.limits.boostLimit.cap
            );
            const availableBoostCapacity = subtractDecimal128(
              sponsorBoostLimitCap,
              sponsorBoostWalletBalance
            );

            if (compareDecimal128(availableBoostCapacity, "0.0") > 0) {
              const actualBonusToCredit = minDecimal128(
                bonusAmount,
                availableBoostCapacity
              );
              if (compareDecimal128(actualBonusToCredit, "0.0") > 0) {
                sponsorLedger.wallets.boost = addDecimal128(
                  sponsorLedger.wallets.boost,
                  actualBonusToCredit
                );
                await sponsorLedger.save();

                boostBonusEntry = await createLedgerEntry({
                  userId: sponsor._id,
                  eventType: "BOOST_BONUS",
                  amount: actualBonusToCredit.toString(),
                  walletFrom: "SYSTEM",
                  walletTo: "BOOST",
                  narrative: `Boost bonus (${
                    bonusPercentage * 100
                  }%) from referral ${user.username}.`,
                  refId: user._id.toString(),
                });
              }
            }
          }
        }
      }
    }

    updateUplineTeamLp(user.uhid, transferAmountD128).catch((err) => {
      console.error(`[BACKGROUND_ERROR] Failed to update team LP:`, err);
    });

    await user.save();
    await ledger.save();

    const lpDepositLedgerEntry = await createLedgerEntry({
      userId: userId,
      eventType: "AUTOPOSITIONING",
      amount: transferAmountD128.toString(),
      walletFrom: "COMMUNITY_REWARDS",
      walletTo: "LP",
      narrative: `Transferred ${transferAmountD128} from COMMUNITY_REWARDS to LP.`,
    });

    const now = new Date();
    // Debit the EcoSystem fee from REWARDS or source wallet ( COMMUNITY_REWARDS)
    if (ecosystemFee == true) {
      const walletFrom = "COMMUNITY_REWARDS"; // adjust as needed
      // Save fee entry in EcosystemFee collection
      let EcosystemFeeEntry = await EcosystemFee.create({
        userId,
        amount: ecosystemFeeDeduction,
        walletFrom,
        ledgerRefId: lpDepositLedgerEntry._id.toString(),
        narrative: "10% ecosystem fee charged during autopositioning",
      });
      const uniqueTransactionId = lpDepositLedgerEntry._id.toString();
      //Make Transaction
      if (compareDecimal128(ecosystemFeeDeduction, "0.0") > 0) {
        const txResult = await usdtTransactions.debitEcosystem(
          ecosystemFeeDeduction,
          uniqueTransactionId
        );
        console.log(txResult);
        chainTxHash = txResult.txHash || txResult.hash;
        EcosystemFeeEntry.refId = chainTxHash;
      }
      EcosystemFeeEntry.save();
    }

    if (boostBonusEntry) {
      await LedgerRow.updateOne(
        { _id: boostBonusEntry._id },
        { $set: { refId: lpDepositLedgerEntry._id.toString() } }
      );
    }

    res.status(200).json({
      success: true,
      message: `Successfully transferred ${transferAmountD128} USDT from COMMUNITY_REWARDS to LP.`,
    });
  } catch (error) {
    console.error("CRITICAL ERROR in addLpFromCOMMUNITY_REWARDS:", error);
    res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

// Add LP from Usdt wallet
const addLpFromUsdt = async (req, res) => {
  console.log("[addLpFromUsdt] Received request");
  try {
    const userId = req.user._id;
    const { transferAmount } = req.body;
    console.log(
      `[addLpFromUsdt] UserID: ${userId}, TransferAmount: ${transferAmount}`
    );

    if (!transferAmount || transferAmount < 9) {
      console.log("[addLpFromUsdt] Error: Invalid transfer amount.");
      return res.status(400).json({
        success: false,
        message: "Valid transfer amount is required",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log("[addLpFromUsdt] Error: User not found.");
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    console.log(`[addLpFromUsdt] Found user: ${user.username}`);

    const transferAmountD128 = ensureDecimal128(transferAmount);
    console.log(
      `[addLpFromUsdt] Parsed transfer amount (Decimal128): ${transferAmountD128.toString()}`
    );

    const ledger = await getOrCreateLedger(userId);
    console.log("[addLpFromUsdt] Fetched or created ledger.");

    // Ensure usdt wallet has enough balance
    const usdtBalanceD128 = ensureDecimal128(
      ledger.wallets.usdt?.toString() || "0.0"
    );
    console.log(
      `[addLpFromUsdt] Current Usdt balance: ${usdtBalanceD128.toString()}`
    );
    if (compareDecimal128(usdtBalanceD128, transferAmountD128) < 0) {
      console.log("[addLpFromUsdt] Error: Insufficient Usdt balance.");
      return res.status(400).json({
        success: false,
        message: `Insufficient Usdt balance. Trying to transfer ${transferAmount}, but only ${usdtBalanceD128.toString()} available.`,
      });
    }

    console.log("[addLpFromUsdt] --- Starting Core Business Logic ---");

    // 1. Update user's self LP counter and check if this is the first deposit
    const isFirstDeposit = (user.counters.selfLp || "0.0").toString() === "0.0";
    console.log(`[addLpFromUsdt] Is first deposit? ${isFirstDeposit}`);
    user.counters.selfLp = addDecimal128(
      user.counters.selfLp || "0.0",
      transferAmountD128
    );
    if (isFirstDeposit) {
      user.firstLpDepositTs = new Date(); // Set first deposit timestamp
      console.log(
        `[addLpFromUsdt] Set firstLpDepositTs for user ${user.username} to ${user.firstLpDepositTs}`
      );
    }

    // 2. Perform wallet transfers (Usdt -> LP)
    const originalUsdt = ledger.wallets.usdt;
    const originalLp = ledger.wallets.lp;
    ledger.wallets.usdt = subtractDecimal128(
      ledger.wallets.usdt,
      transferAmountD128
    );
    ledger.wallets.lp = addDecimal128(ledger.wallets.lp, transferAmountD128);
      // Ensure lpLimit object exists
      if (!ledger.limits.lpLimit) {
        ledger.limits.lpLimit = {
          cap: mongoose.Types.Decimal128.fromString("0.0"),
          used: mongoose.Types.Decimal128.fromString("0.0"),
        };
      }
    
        // Update lpLimit.cap = 2 × LP balance
      const currentLpBalance = ensureDecimal128(ledger.wallets.lp);
      const newLpCap = multiplyDecimal128(currentLpBalance, "2");
      const oldLpCap = ledger.limits.lpLimit.cap;
      ledger.limits.lpLimit.cap = newLpCap;
    
      // console.log(
      //   `[addLpFromUsdt] LP limit cap updated: ${oldLpCap?.toString()} -> ${newLpCap.toString()}`
      // );
    
      // Ensure firstLpDepositTs is set
      if (!user.firstLpDepositTs) {
        user.firstLpDepositTs = new Date();
        // console.log(
        //   `[addLpFromUsdt] firstLpDepositTs initialized for user ${user.username} -> ${user.firstLpDepositTs}`
        // );
      }
    // console.log(
    //   `[addLpFromUsdt] Usdt wallet updated: ${originalUsdt} -> ${ledger.wallets.usdt}`
    // );
    // console.log(
    //   `[addLpFromUsdt] LP wallet updated: ${originalLp} -> ${ledger.wallets.lp}`
    // );

    // 3. Handle Airdrop activation (Swift -> Airdrop)
    console.log("[addLpFromUsdt] Handling Airdrop activation...");

    // This will hold the boost bonus entry if it's created
    let boostBonusEntry = null;

    // Calculate airdrop promotion percentage based on config
    const { startTimestamp, steps } = airdropPromotionConfig;
    const now = Date.now();
    let promotionPercentage = 0;
    let narrativeSuffix = " (Promotion not active).";

    if (now >= startTimestamp) {
      let elapsedHours = (now - startTimestamp) / (1000 * 60 * 60);
      let cumulativeHours = 0;
      let promotionFound = false;

      for (const step of steps) {
        cumulativeHours += step.durationHours;
        if (elapsedHours < cumulativeHours) {
          promotionPercentage = step.percentage;
          narrativeSuffix = ` (Promotion active at ${step.percentage * 100}%).`;
          promotionFound = true;
          break;
        }
      }
      if (!promotionFound) {
        console.log(
          `[addLpFromUsdt] Airdrop promotion has ended. Elapsed hours: ${elapsedHours.toFixed(
            2
          )}`
        );
        narrativeSuffix = " (Promotion has ended).";
      }
    } else {
      console.log(
        `[addLpFromUsdt] Airdrop promotion has not started yet. Starts at ${new Date(
          startTimestamp
        ).toISOString()}`
      );
    }
    console.log(
      `[addLpFromUsdt] Airdrop promotion percentage: ${promotionPercentage}`
    );

    const swiftBalance =
      ledger.wallets.swift || mongoose.Types.Decimal128.fromString("0.0");

    // Calculate the potential amount to move based on the promotion percentage of the transfer amount
    const promotionalAmount = multiplyDecimal128(
      transferAmountD128,
      promotionPercentage.toString()
    );

    // The actual amount to move is the lesser of the promotional amount and the available swift balance
    const amountToMoveFromSwift = minDecimal128(
      promotionalAmount,
      swiftBalance
    );

    console.log(
      `[addLpFromUsdt] Swift balance: ${swiftBalance}, Promotional Amount: ${promotionalAmount}, Final Amount to move from Swift: ${amountToMoveFromSwift}`
    );

    if (compareDecimal128(amountToMoveFromSwift, "0.0") > 0) {
      const originalSwift = ledger.wallets.swift;
      const originalAirdrop = ledger.wallets.airdrop;
      const originalAirdropCap = ledger.limits.airdropLimit?.cap;

      ledger.wallets.swift = subtractDecimal128(
        swiftBalance,
        amountToMoveFromSwift
      );
      /* uncomment this on airdrop-reactivation */
      // ledger.wallets.airdrop = addDecimal128(
      //   ledger.wallets.airdrop || "0.0",
      //   amountToMoveFromSwift
      // );

      if (!ledger.limits.airdropLimit) {
        ledger.limits.airdropLimit = {
          cap: mongoose.Types.Decimal128.fromString("0.0"),
          used: mongoose.Types.Decimal128.fromString("0.0"),
        };
      }
      ledger.limits.airdropLimit.cap = addDecimal128(
        ledger.limits.airdropLimit.cap || "0.0",
        amountToMoveFromSwift
      );

      console.log(
        `[addLpFromUsdt] Swift wallet updated: ${originalSwift} -> ${ledger.wallets.swift}`
      );
      console.log(
        `[addLpFromUsdt] Airdrop wallet updated: ${originalAirdrop} -> ${ledger.wallets.airdrop}`
      );
      console.log(
        `[addLpFromUsdt] Airdrop limit cap updated: ${originalAirdropCap} -> ${ledger.limits.airdropLimit.cap}`
      );

      await createLedgerEntry({
        userId: userId,
        eventType: "AIRDROP_ACTIVATION",
        amount: amountToMoveFromSwift.toString(),
        walletFrom: "SWIFT",
        walletTo: "AIRDROP",
        narrative: `Airdrop activation for ${amountToMoveFromSwift.toString()} matching LP deposit.${narrativeSuffix}`,
      });
      console.log("[addLpFromUsdt] Created AIRDROP_ACTIVATION ledger entry.");
    } else {
      console.log(
        "[addLpFromUsdt] No amount to move from Swift, skipping Airdrop activation."
      );
    }

    // 4. Update all relevant limits
    console.log("[addLpFromUsdt] Updating limits...");
    const originalBoostCap = ledger.limits.boostLimit?.cap;
    const original5xCap = ledger.limits.fiveXLimit?.cap;
// --- BOOST LIMIT LOGIC ---
// --- BOOST LIMIT LOGIC (safe) ---
let firstDepositDate = null;
// prefer firstLpDepositTs if available
if (user.firstLpDepositTs) {
  firstDepositDate = new Date(user.firstLpDepositTs);
} else {
  firstDepositDate = new Date();
}

if (firstDepositDate && !isNaN(firstDepositDate.getTime())) {
  const endDate = new Date(firstDepositDate);
  endDate.setDate(endDate.getDate() + 30);
  endDate.setHours(23, 59, 59, 999);

  if (new Date() <= endDate) {
    const originalBoostCap = ledger.limits.boostLimit?.cap;
    ledger.limits.boostLimit.cap = addDecimal128(
      ledger.limits.boostLimit.cap || "0.0",
      transferAmountD128
    );
    console.log(
      `[addLpFromUsdt] Boost limit cap updated (within 29 days): ${originalBoostCap} -> ${ledger.limits.boostLimit.cap}`
    );
  } else {
    console.log(
      `[addLpFromUsdt] Skipped boost limit update (after 29-day cutoff). FirstDepositTs=${firstDepositDate.toISOString()}`
    );
  }
} else {
  console.warn(
    `[addLpFromUsdt] No valid first deposit date found for user ${user.username}. Skipping boost limit update.`
  );
}

    ledger.limits.fiveXLimit.cap = multiplyDecimal128(ledger.wallets.lp, "5");
    console.log(
      `[addLpFromUsdt] Boost limit cap updated: ${originalBoostCap} -> ${ledger.limits.boostLimit.cap}`
    );
    console.log(
      `[addLpFromUsdt] 5x limit cap updated: ${original5xCap} -> ${ledger.limits.fiveXLimit.cap}`
    );

    // 5. Handle Sponsor Bonus
    if (user.sponsorId) {
      console.log(
        "[addLpFromUsdt] User has a sponsor, processing bonus logic..."
      );
      console.log(`[addLpFromUsdt] User has sponsor: ${user.sponsorId}`);
      const sponsor = await User.findById(user.sponsorId);

      if (!sponsor) {
        console.log(
          `[addLpFromUsdt] Sponsor with ID ${user.sponsorId} could not be found in the database.`
        );
      } else {
        // Fetch sponsor's ledger once to handle retroactive update and bonus calculation.
        const sponsorLedger = await getOrCreateLedger(sponsor._id);

        // If sponsor has no timestamp, check if they should be retroactively assigned one.
        if (!sponsor.firstLpDepositTs) {
          console.log(
            `[addLpFromUsdt] Sponsor ${sponsor.username} does not have 'firstLpDepositTs' set. Checking LP balance for retroactive update.`
          );
          const sponsorLpBalance =
            sponsorLedger.wallets.lp ||
            mongoose.Types.Decimal128.fromString("0.0");

          if (compareDecimal128(sponsorLpBalance, "0.0") > 0) {
            sponsor.firstLpDepositTs = new Date();
            await sponsor.save();
            console.log(
              `[addLpFromUsdt] Retroactively set 'firstLpDepositTs' for sponsor ${sponsor.username} due to existing LP balance.`
            );
          } else {
            console.log(
              `[addLpFromUsdt] Sponsor ${sponsor.username} has no LP balance. 'firstLpDepositTs' remains unset.`
            );
          }
        }

        // Now, proceed with bonus logic if the sponsor is eligible (has the timestamp).
        if (sponsor.firstLpDepositTs) {
          console.log(
            `[addLpFromUsdt] Proceeding with bonus check for sponsor ${sponsor.username}. Timestamp: ${sponsor.firstLpDepositTs}`
          );
          const sponsorFirstLpTime = new Date(
            sponsor.firstLpDepositTs
          ).getTime();
          const currentUserDepositTime = new Date().getTime();
          const hoursDifference =
            (currentUserDepositTime - sponsorFirstLpTime) / (1000 * 60 * 60);
          console.log(
            `[addLpFromUsdt] Hours since sponsor's first deposit: ${hoursDifference}`
          );

          let bonusPercentage = 0;
          bonusPercentage =  getSponsorBonusPctUTC(sponsor.firstLpDepositTs);
            console.log(bonusPercentage,"===================bonusPercentage=====================");
          console.log(
            `[addLpFromUsdt] Calculated bonus percentage: ${bonusPercentage}`
          );

          if (bonusPercentage > 0) {
            const bonusAmount = multiplyDecimal128(
              transferAmountD128,
              bonusPercentage.toString()
            );
            console.log(
              `[addLpFromUsdt] Calculated raw bonus amount for sponsor ${
                sponsor.username
              }: ${bonusAmount.toString()}`
            );

            // --- FIX STARTS HERE: Check sponsor's boost limit ---
            const sponsorBoostWalletBalance = ensureDecimal128(
              sponsorLedger.wallets.boost
            );
            const sponsorBoostLimitCap = ensureDecimal128(
              sponsorLedger.limits.boostLimit.cap
            );

            const availableBoostCapacity = subtractDecimal128(
              sponsorBoostLimitCap,
              sponsorBoostWalletBalance
            );
            console.log(
              `[BOOST_BONUS_CHECK] Sponsor: ${
                sponsor.username
              }, Boost Balance: ${sponsorBoostWalletBalance.toString()}, Boost Limit: ${sponsorBoostLimitCap.toString()}, Available Capacity: ${availableBoostCapacity.toString()}`
            );

            if (compareDecimal128(availableBoostCapacity, "0.0") > 0) {
              const actualBonusToCredit = minDecimal128(
                bonusAmount,
                availableBoostCapacity
              );
              console.log(
                `[BOOST_BONUS_CHECK] Sponsor: ${
                  sponsor.username
                }, Raw Bonus: ${bonusAmount.toString()}, Capped Bonus to Credit: ${actualBonusToCredit.toString()}`
              );

              if (compareDecimal128(actualBonusToCredit, "0.0") > 0) {
                const originalSponsorBoost = sponsorLedger.wallets.boost;
                sponsorLedger.wallets.boost = addDecimal128(
                  sponsorLedger.wallets.boost,
                  actualBonusToCredit
                );

                await sponsorLedger.save(); // Save the sponsor's ledger immediately after modification
                console.log(
                  `[addLpFromUsdt] Updating sponsor's Boost wallet: ${originalSponsorBoost} -> ${sponsorLedger.wallets.boost}. Ledger saved.`
                );

                // Create the entry and store it
                boostBonusEntry = await createLedgerEntry({
                  userId: sponsor._id,
                  eventType: "BOOST_BONUS",
                  amount: actualBonusToCredit.toString(),
                  walletFrom: "SYSTEM",
                  walletTo: "BOOST",
                  narrative: `Boost bonus (${
                    bonusPercentage * 100
                  }%) from direct referral ${user.username}'s deposit.`,
                  refId: user._id.toString(), // Temporary refId
                });
                console.log(
                  `[addLpFromUsdt] Created BOOST_BONUS ledger entry for sponsor with temp refId.`
                );
              } else {
                console.log(
                  `[addLpFromUsdt] Sponsor ${sponsor.username} bonus is 0 after capping. No update.`
                );
              }
            } else {
              console.log(
                `[BOOST_BONUS_CHECK] Sponsor: ${sponsor.username} has no available capacity in boost wallet. Skipping boost bonus.`
              );
            }
            // --- FIX ENDS HERE ---
          }
        } else {
          console.log(
            `[addLpFromUsdt] Sponsor ${sponsor.username} is not eligible for a bonus (no LP deposit timestamp).`
          );
        }
      }
    } else {
      console.log("[addLpFromUsdt] User does not have a sponsor.");
    }

    // 6. Update Upline Team LP Counters (fire and forget)
    console.log("[addLpFromUsdt] Triggering Upline Team LP Counter update...");
    updateUplineTeamLp(user.uhid, transferAmountD128).catch((err) => {
      console.error(
        `[BACKGROUND_ERROR] Failed to update team LP for user ${user.uhid}:`,
        err
      );
    });
    console.log("[addLpFromUsdt] Upline update process initiated.");

    // 7. Save all changes and create the primary ledger entry
    console.log("[addLpFromUsdt] Saving user and ledger...");
    await user.save();
    await ledger.save();
    console.log("[addLpFromUsdt] User and ledger saved.");

    const lpDepositLedgerEntry = await createLedgerEntry({
      userId: userId,
      eventType: "LP_DEPOSIT_FROM_USDT",
      amount: transferAmountD128.toString(),
      walletFrom: "USDT",
      walletTo: "LP",
      narrative: `Transferred ${transferAmount} from Usdt to LP wallet.`,
    });

    console.log(
      "[addLpFromUsdt] Created final LP_DEPOSIT_FROM_USDT ledger entry."
    );

    // If a boost bonus was created, update it with the correct refId
    if (boostBonusEntry) {
      await LedgerRow.updateOne(
        { _id: boostBonusEntry._id },
        { $set: { refId: lpDepositLedgerEntry._id.toString() } }
      );
      console.log(
        `[addLpFromUsdt] Updated BOOST_BONUS entry ${boostBonusEntry._id} with refId ${lpDepositLedgerEntry._id}.`
      );
    }

    console.log("[addLpFromUsdt] Request successful.");
    res.status(200).json({
      success: true,
      message: `Successfully transferred ${transferAmount} USDT from Usdt to LP wallet.`,
    });
  } catch (error) {
    console.error("CRITICAL ERROR in addLpFromUsdt:", error);
    res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

// Helper function to handle common transfer logic
async function executeTransfer(
  userId,
  amountStr,
  fromWalletField,
  toWalletField,
  ledger
) {
  const amountDecimal = ensureDecimal128(amountStr);

  const fromWalletBalance = ledger.wallets[fromWalletField]
    ? parseFloat(ledger.wallets[fromWalletField].toString())
    : 0;
  if (fromWalletBalance < parseFloat(amountDecimal.toString())) {
    throw new Error(`Insufficient balance in ${fromWalletField} wallet.`);
  }

  ledger.wallets[fromWalletField] = subtractDecimal128(
    ledger.wallets[fromWalletField] || "0.0",
    amountDecimal
  );
  ledger.wallets[toWalletField] = addDecimal128(
    ledger.wallets[toWalletField] || "0.0",
    amountDecimal
  );

  await ledger.save();

  await createLedgerEntry(
    userId,
    "INTERNAL_TRANSFER",
    amountDecimal,
    fromWalletField.toUpperCase(), // e.g., LP, COMMUNITY_REWARDS
    toWalletField.toUpperCase(), // e.g., USDT
    `Transfer from ${fromWalletField} to ${toWalletField}`,
    null // refId
  );
}

const transferLpToUsdt = async (req, res) => {
  try {
    const userId = req.user._id;
    const { amount } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid transfer amount is required.",
      });
    }

    const ledger = await getOrCreateLedger(userId);

    await executeTransfer(userId, amount, "lp", "usdt", ledger);

    res.status(200).json({
      success: true,
      message: "Transfer from LP to Usdt successful.",
    });
  } catch (error) {
    console.error("Error in transferLpToUsdt:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error during LP to Usdt transfer.",
    });
  }
};

const transferRewardsToUsdt = async (req, res) => {
  try {
    const userId = req.user._id;
    const { amount } = req.body; // This amount would typically be the full pending rewards

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid transfer amount is required.",
      });
    }

    const ledger = await getOrCreateLedger(userId);

    // Note: 'communityRewards' is the field in Ledger.wallets
    await executeTransfer(userId, amount, "communityRewards", "usdt", ledger);

    // Potentially clear pending rewards or update total rewards if necessary.
    // For now, this just moves the balance. The UI/caller might need to ensure
    // that 'amount' corresponds to actual redeemable rewards.

    res.status(200).json({
      success: true,
      message: "Transfer from Community Rewards to Usdt successful.",
    });
  } catch (error) {
    console.error("Error in transferRewardsToUsdt:", error);
    res.status(500).json({
      success: false,
      message:
        error.message ||
        "Server error during Community Rewards to Usdt transfer.",
    });
  }
};

// team stats controller

const withdrawUSDT = async (req, res) => {
  try {
    const userId = req.user._id;
    const { amount, walletFrom, destinationAddress } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid transfer amount is required.",
      });
    }

    if (!walletFrom || !destinationAddress) {
      return res.status(400).json({
        success: false,
        message: "Wallet from and destination address are required.",
      });
    }

    const ledger = await getOrCreateLedger(userId);

    if (!ledger.totalRewardsWithdrawal)
      ledger.totalRewardsWithdrawal = Decimal.fromString("0.0");

    const amountD128 = Decimal.fromString(amount.toString());

    // --- REVISED WITHDRAWAL VALIDATION LOGIC ---
    if (walletFrom === "ZERO_RISK") {
      const usdtBalance = ledger.wallets.usdt || Decimal.fromString("0.0");
      const lpBalance = ledger.wallets.lp || Decimal.fromString("0.0");
      const rewardsBalance =
        ledger.wallets.communityRewards || Decimal.fromString("0.0");
      const zeroRiskCap =
        ledger.wallets.zeroRisk?.cap || Decimal.fromString("0.0");
      const totalRewardsWithdrawal =
        ledger.totalRewardsWithdrawal || Decimal.fromString("0.0");

      // This is the pool of funds that back the zero risk guarantee
      const principalAndStaging = addDecimal128(usdtBalance, lpBalance);

      // Per the new rule, the accessible principal is reduced by any available rewards
      const accessiblePrincipal = subtractDecimal128(
        principalAndStaging,
        rewardsBalance
      );

      // The max withdrawable is the lesser of the original principal limit (zeroRiskCap)
      // and the newly calculated accessible principal.
      const effectiveLimit = minDecimal128(zeroRiskCap, accessiblePrincipal);

      // This is then further reduced by any rewards that have already been withdrawn.
      const limitAfterPreviousWithdrawals = subtractDecimal128(
        effectiveLimit,
        totalRewardsWithdrawal
      );

      // The final amount cannot be negative.
      const maxWithdrawableZeroRisk = maxDecimal128(
        "0.0",
        limitAfterPreviousWithdrawals
      );

      if (compareDecimal128(amountD128, maxWithdrawableZeroRisk) > 0) {
        // amount > maxWithdrawable
        throw new Error(
          `Withdrawal amount of ${amount.toString()} USDT exceeds your Zero Risk balance. Maximum available: ${maxWithdrawableZeroRisk.toString()} USDT.`
        );
      }
    } else if (walletFrom === "LP") {
      const currentBalance = ledger.wallets.lp || Decimal.fromString("0.0");

      if (compareDecimal128(amountD128, currentBalance) > 0) {
        // currentBalance < amount
        throw new Error(
          `Insufficient balance in LP wallet. Available: ${currentBalance.toString()}, Tried: ${amount}`
        );
      }

      // Apply additional earning-based 5X limits for these wallets
      const zeroRiskLimit =
        ledger.wallets.zeroRisk?.cap || Decimal.fromString("0.0");
      const fiveXUsed =
        ledger.limits.fiveXLimit?.used || Decimal.fromString("0.0");
      const fiveXCap =
        ledger.limits.fiveXLimit?.cap || Decimal.fromString("0.0");
      const fiveXRemaining = subtractDecimal128(fiveXCap, fiveXUsed);

      // User can withdraw up to their remaining zero-risk deposit amount, but not more than their remaining 5x earning potential.
      const maxWithdrawable = minDecimal128(zeroRiskLimit, fiveXRemaining);

      if (compareDecimal128(amountD128, maxWithdrawable) > 0) {
        // amount > maxWithdrawable
        throw new Error(
          `Withdrawal amount of ${amount.toString()} USDT exceeds your current earning-based limit. Maximum withdrawable: ${maxWithdrawable.toString()} USDT`
        );
      }
    } else if (walletFrom === "COMMUNITY_REWARDS") {
      const currentBalance =
        ledger.wallets.communityRewards || Decimal.fromString("0.0");
      if (compareDecimal128(amountD128, currentBalance) > 0) {
        // currentBalance < amount
        throw new Error(
          `Insufficient balance in COMMUNITY_REWARDS wallet. Available: ${currentBalance.toString()}, Tried: ${amount}`
        );
      }
      // No other validation needed for a simple rewards withdrawal
    }
    // --- END REVISED VALIDATION ---

    // Process USDT transaction
    const txResult = await usdtTransactions.sendUsdt({
      destination: destinationAddress,
      amount: amount.toString(),
    });

    let newBalance;

    // --- REVISED WITHDRAWAL LIMIT LOGIC (Apply) ---
    // Update wallet balance and limits based on withdrawal source
    console.log(
      `[Withdrawal Apply] About to process withdrawal logic for walletFrom: '${walletFrom}'`
    );
    if (walletFrom === "ZERO_RISK") {
      const amountFromUsdt = minDecimal128(
        amountD128,
        ledger.wallets.usdt || Decimal.fromString("0.0")
      );
      const amountFromLp = subtractDecimal128(amountD128, amountFromUsdt);

      ledger.wallets.usdt = subtractDecimal128(
        ledger.wallets.usdt || "0.0",
        amountFromUsdt
      );

      if (compareDecimal128(amountFromLp, "0.0") > 0) {
        ledger.wallets.lp = subtractDecimal128(
          ledger.wallets.lp || "0.0",
          amountFromLp
        );

        // ** DECREASE UPLINE TEAM LP **
        // Fire-and-forget call to the service to decrease the team LP for the upline.
        decreaseUplineTeamLp(userId, amountFromLp).catch((err) => {
          console.error(
            `[BACKGROUND_ERROR] Failed to decrease team LP for user ${userId} on withdrawal:`,
            err
          );
        });

        // Also reduce airdrop wallet balance when LP is touched
        ledger.wallets.airdrop = subtractDecimal128(
          ledger.wallets.airdrop || "0.0",
          amountFromLp
        );
        if (compareDecimal128(ledger.wallets.airdrop, "0.0") < 0)
          ledger.wallets.airdrop = Decimal.fromString("0.0");

        // If withdrawal touches LP wallet, reset limits to new LP balance
        ledger.limits.boostLimit.cap = ledger.wallets.lp;
        // No zeroRisk cap tracking – wallets.zeroRisk is the single source.
        ledger.limits.airdropLimit.cap = ledger.wallets.lp;

        // --- Sponsor Boost Wallet Reduction Logic ---
        if (userId) {
          try {
            const userLedger = await getOrCreateLedger(userId);
            // The reduction amount is 50% of the amount taken from LP
            const reductionAmount = multiplyDecimal128(amountFromLp, "0.5");

            const oldUserBoost =
              userLedger.wallets.boost || Decimal.fromString("0.0");
            userLedger.wallets.boost = subtractDecimal128(
              oldUserBoost,
              reductionAmount
            );

            if (compareDecimal128(userLedger.wallets.boost, "0.0") < 0) {
              userLedger.wallets.boost = Decimal.fromString("0.0");
            }
            await userLedger.save();
            console.log(
              `[Sponsor Update] Successfully reduced user ${userId}'s boost wallet by ${reductionAmount.toString()} (based on LP withdrawal of ${amountFromLp.toString()}).`
            );
          } catch (e) {
            console.error(
              `[Sponsor Update] CRITICAL ERROR: Failed to update user's boost wallet for user ${userId}. Error:`,
              e
            );
          }
        }
        // --- End Sponsor Boost Wallet Reduction Logic ---
      }

      newBalance = addDecimal128(ledger.wallets.usdt, ledger.wallets.lp);
    } else if (walletFrom === "COMMUNITY_REWARDS") {
      ledger.wallets.communityRewards = subtractDecimal128(
        ledger.wallets.communityRewards || "0.0",
        amountD128
      );
      ledger.totalRewardsWithdrawal = addDecimal128(
        ledger.totalRewardsWithdrawal || "0.0",
        amountD128
      );
      newBalance = ledger.wallets.communityRewards;
      // NOTE: No other limits are affected for a simple rewards withdrawal.
    } else if (walletFrom === "LP") {
      // This is a placeholder for the more complex LP withdrawal logic that would need to be moved here.
      // It's separate now to ensure Community Rewards withdrawals are clean.
      throw new Error(
        "Withdrawals from LP directly are not yet fully implemented in this refactored logic."
      );
    }

    // Recalculate 5x limit cap for ALL withdrawals based *only* on the current LP wallet balance
    const lpBalanceFor5x = ledger.wallets.lp || Decimal.fromString("0.0");
    ledger.limits.fiveXLimit.cap = multiplyDecimal128(lpBalanceFor5x, "5.0");

    await ledger.save();

    // Create ledger entry
    await createLedgerEntry({
      userId,
      eventType:
        walletFrom === "COMMUNITY_REWARDS" ? "REWARDS_REDEEMED" : "WITHDRAWAL",
      amount: amountD128.toString(),
      walletFrom: walletFrom,
      walletTo: "EXTERNAL",
      narrative:
        walletFrom === "COMMUNITY_REWARDS"
          ? `Community Rewards redeemed to ${destinationAddress}`
          : `USDT withdrawal from ${walletFrom} to ${destinationAddress}`,
      refId: txResult.hash,
    });

    res.status(200).json({
      success: true,
      message: "Claim successful",
      transactionHash: txResult.hash,
      withdrawnFrom: walletFrom,
      newBalance: parseFloat(newBalance.toString()),
      limitsAfterWithdrawal: {
        zeroRisk: parseFloat(ledger.wallets.zeroRisk.toString()),
        fiveX: parseFloat(ledger.limits.fiveXLimit.cap.toString()),
        swift: parseFloat(ledger.limits.swiftLimit.cap.toString()),
        boost: parseFloat(ledger.limits.boostLimit.cap.toString()),
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// Get withdrawals history for authenticated user
const getWithdrawalsHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get withdrawal history from ledger rows
    const withdrawals = await LedgerRow.find({
      userId,
      eventType: "WITHDRAWAL",
    })
      .sort({ ts: -1 })
      .select("ts amount walletFrom narrative refId")
      .lean();

    res.json({
      success: true,
      withdrawals: withdrawals.map((withdrawal) => ({
        transactionId: withdrawal.refId,
        amount: parseFloat(withdrawal.amount).toFixed(6),
        walletFrom: withdrawal.walletFrom,
        narrative: withdrawal.narrative,
        timestamp: withdrawal.ts,
        status: "completed",
      })),
    });
  } catch (error) {
    console.error("Error fetching withdrawals history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawals history",
    });
  }
};

const getLedgerLevelRewards = async (req, res) => {
  try {
    const userId = req.user.id; // from auth middleware

    // Fetch logs for the specific user, for the relevant reward types
    const rewards = await DailyRewardLog.find({
      userId,
      rewardType: { $in: ["cascade", "daily_roi", "rank_bonus"] },
    })
      .sort({ date: -1 })
      .lean();

    // Group by date
    // ... existing code ...
  } catch (error) {
    console.error("Error fetching ledger level rewards:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching ledger level rewards.",
    });
  }
};
/**
 * GET TEAM DAILY TOTAL LEDGER
 * Uses req.user._id
 *     Supports:
       - ?from=YYYY-MM-DD
       - ?to=YYYY-MM-DD
       - default: today UTC
 * Default: today (UTC)
 */
const getTeamDailyLedgerTotals = async (req, res) => {
  try {
    const userId = req.user._id;
    const { from, to, search } = req.query;

    let start, end;

    /* ===========================
       DATE RANGE (UTC)
    =========================== */
    if (from || to) {
      const fromDate = from || to;
      const toDate = to || from;

      start = new Date(`${fromDate}T00:00:00.000Z`);
      end = new Date(`${toDate}T23:59:59.999Z`);
    } else {
      const now = new Date();
      start = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0, 0, 0, 0
      ));
      end = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23, 59, 59, 999
      ));
    }

    const responseFrom = start.toISOString().slice(0, 10);
    const responseTo = end.toISOString().slice(0, 10);

    /* ===========================
       GET LOGGED-IN USER UHID
    =========================== */
    const user = await User.findById(userId, { uhid: 1 }).lean();
    if (!user?.uhid) {
      return res.status(404).json({
        success: false,
        message: "User UHID not found",
      });
    }

    const loggedInUHID = String(user.uhid);
    let effectiveParentUHID = loggedInUHID;

    /* ===========================
       SEARCH OVERRIDE
       (username / email / uhid)
    =========================== */
    if (search) {
      const searchStr = String(search).trim();

      const targetUser = await User.findOne(
        {
          $or: [
            { username: searchStr },
            { email: searchStr },
            { uhid: searchStr },
            { uhid: Number(searchStr) },
          ],
        },
        { uhid: 1 }
      ).lean();

      if (!targetUser?.uhid) {
        return res.status(404).json({
          success: false,
          message: "User not found for given search",
        });
      }

      const targetUHID = String(targetUser.uhid);

      /* 🔒 SECURITY CHECK — MUST BE DIRECT CHILD */
      const isChild = await mongoose.connection
        .collection("levels")
        .findOne({
          parent: loggedInUHID,
          child: targetUHID,
        });

      if (!isChild) {
        return res.status(403).json({
          success: false,
          message: "User is not part of your team",
        });
      }

      // ✅ Override parent UHID
      effectiveParentUHID = targetUHID;
    }

    /* ===========================
       AGGREGATION
    =========================== */
    const totals = await LedgerRow.aggregate([
      // 1️⃣ Join users to get UHID
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },

      // 2️⃣ Join levels (team relation)
      {
        $lookup: {
          from: "levels",
          let: { userUhid: "$user.uhid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$parent", effectiveParentUHID] },
                    { $eq: ["$child", "$$userUhid"] },
                  ],
                },
              },
            },
          ],
          as: "team",
        },
      },

      // 3️⃣ Filter: self OR team + date + events
      {
        $match: {
          $expr: {
            $or: [
              { $eq: ["$user.uhid", effectiveParentUHID] },
              { $gt: [{ $size: "$team" }, 0] },
            ],
          },
          ts: { $gte: start, $lte: end },
          eventType: {
            $in: ["DEPOSIT", "WITHDRAWAL", "REWARDS_REDEEMED"],
          },
        },
      },

      // 4️⃣ Group totals
      {
        $group: {
          _id: "$eventType",
          totalAmount: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    /* ===========================
       NORMALIZE TOTALS
    =========================== */
    let deposited = 0;
    let withdrawal = 0;
    let redeemed = 0;

    totals.forEach(t => {
      if (t._id === "DEPOSIT") deposited = t.totalAmount;
      if (t._id === "WITHDRAWAL") withdrawal = t.totalAmount;
      if (t._id === "REWARDS_REDEEMED") redeemed = t.totalAmount;
    });

    return res.json({
      success: true,
      from: responseFrom,
      to: responseTo,
      scopeUHID: effectiveParentUHID, // 🔍 helpful for frontend
      totals: {
        deposited,
        withdrawal,
        redeemed,
      },
    });
  } catch (err) {
    console.error("❌ getTeamDailyLedgerTotals", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
const checkPoolRewardEligibility = async (req, res) => {
  try {
    const userId = req.user._id;

    /* ===========================
       FIXED DATE WINDOW (UTC)
    =========================== */
    const RANGE_START = new Date("2025-12-07T00:00:00.000Z");
    const RANGE_END   = new Date("2026-01-15T23:59:59.999Z");

    /* ===========================
       STEP 1: USER + UHID
    =========================== */
    const user = await User.findById(userId, { uhid: 1 }).lean();
    if (!user?.uhid) {
      return res.status(404).json({
        success: false,
        message: "User UHID not found",
      });
    }

    const parentUHID = String(user.uhid);

    /* ===========================
       STEP 2: SELF ELIGIBILITY
       OPTION A: CURRENT LP
    =========================== */
    const ledger = await Ledger.findOne(
      { userId },
      { "wallets.lp": 1 }
    ).lean();

    const currentLp = Number(ledger?.wallets?.lp?.toString() || 0);
    const currentLpQualified = currentLp >= 1000;

    /* ===========================
       OPTION B: FRESH DEPOSIT
       (USDT ONLY)
    =========================== */
    const depositAgg = await LedgerRow.aggregate([
      {
        $match: {
          userId,
          eventType: "DEPOSIT",
          walletTo: "USDT",
          ts: { $gte: RANGE_START, $lte: RANGE_END },
        },
      },
      {
        $group: {
          _id: null,
          totalDeposit: {
            $sum: {
              $convert: {
                input: "$amount",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]);

    const freshDeposit = depositAgg[0]?.totalDeposit || 0;
    const depositQualified = freshDeposit >= 1000;

    const selfQualified = currentLpQualified || depositQualified;

    if (!selfQualified) {
      return res.json({
        success: true,
        eligible: false,
        dateWindow: { from: "2025-12-07", to: "2026-01-15" },
        self: {
          lpMaintained: currentLpQualified,
          depositQualified,
          depositDone: freshDeposit,
          depositRequired: 1000,
          selfQualified: false,
        },
        summary: {
          status: "NOT_ELIGIBLE",
          pendingReasons: [
            !currentLpQualified ? "LP_BELOW_1000" : null,
            !depositQualified ? "SELF_DEPOSIT_PENDING" : null,
          ].filter(Boolean),
        },
      });
    }

    /* ===========================
       STEP 3: DIRECT LEGS
    =========================== */
    const directLegs = await Level.find(
      { parent: parentUHID, level: 1 },
      { child: 1 }
    ).lean();

    if (!directLegs.length) {
      return res.json({
        success: true,
        eligible: false,
        self: { selfQualified: true },
        summary: {
          status: "NOT_ELIGIBLE",
          pendingReasons: ["NO_DIRECT_LEGS"],
        },
      });
    }

    /* ===========================
       FETCH LEG USERNAMES
    =========================== */
    const legUHIDs = directLegs.map(l => String(l.child));

    const legUsers = await User.find(
      { uhid: { $in: legUHIDs } },
      { uhid: 1, username: 1 }
    ).lean();

    const legUsernameMap = {};
    legUsers.forEach(u => {
      legUsernameMap[String(u.uhid)] = u.username;
    });

    /* ===========================
       STEP 4: PROCESS LEGS
    =========================== */
    const REQUIRED_ACTIVITY = 5000;
    const REQUIRED_LEGS = 3;

    const legResults = [];

    for (const leg of directLegs) {
      const legUHID = String(leg.child);

      const teamLevels = await Level.find(
        { parent: legUHID },
        { child: 1 }
      ).lean();

      const teamUHIDs = [
        legUHID,
        ...teamLevels.map(l => String(l.child)),
      ];

      const teamUsers = await User.find(
        { uhid: { $in: teamUHIDs } },
        { _id: 1 }
      ).lean();

      if (!teamUsers.length) continue;

      const teamUserIds = teamUsers.map(u => u._id);

      const teamDepositAgg = await LedgerRow.aggregate([
        {
          $match: {
            userId: { $in: teamUserIds },
            eventType: "DEPOSIT",
            walletTo: "USDT",
            ts: { $gte: RANGE_START, $lte: RANGE_END },
          },
        },
        {
          $group: {
            _id: null,
            totalDeposit: {
              $sum: {
                $convert: {
                  input: "$amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
        },
      ]);

      const teamDeposit = teamDepositAgg[0]?.totalDeposit || 0;
      const activityCount = Math.min(teamDeposit, REQUIRED_ACTIVITY);

      legResults.push({
        legUhid: legUHID,
        username: legUsernameMap[legUHID] || "Unknown",
        activityCount,
        requiredActivity: REQUIRED_ACTIVITY,
        pendingActivity: Math.max(REQUIRED_ACTIVITY - activityCount, 0),
        qualified: activityCount >= REQUIRED_ACTIVITY,
      });
    }

    /* ===========================
       PICK TOP 3 LEGS
       (Qualified first, then highest activity)
    =========================== */
    const topLegResults = legResults
      .sort((a, b) => {
        if (a.qualified !== b.qualified) {
          return a.qualified ? -1 : 1;
        }
        return b.activityCount - a.activityCount;
      })
      .slice(0, REQUIRED_LEGS);

    /* ===========================
       STEP 5: FINAL DECISION
    =========================== */
    const qualifiedLegs = topLegResults.filter(l => l.qualified);
    const isEligible = qualifiedLegs.length >= REQUIRED_LEGS;

    if (isEligible) {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            iphone17ProAchiever: true,
            iphone17ProAchievedAt: new Date(),
          },
        }
      );
    }

    return res.json({
      success: true,
      eligible: isEligible,
      dateWindow: { from: "2025-12-07", to: "2026-01-15" },
      self: {
        lpMaintained: currentLpQualified,
        depositQualified,
        depositDone: freshDeposit,
        depositRequired: 1000,
        selfQualified: true,
      },
      legs: {
        requiredQualifiedLegs: REQUIRED_LEGS,
        qualifiedLegs: qualifiedLegs.length,
        pendingLegs: Math.max(REQUIRED_LEGS - qualifiedLegs.length, 0),
        details: topLegResults,
      },
      summary: {
        status: isEligible ? "ELIGIBLE" : "NOT_ELIGIBLE",
        pendingReasons: isEligible ? [] : ["INSUFFICIENT_QUALIFIED_LEGS"],
      },
    });
  } catch (err) {
    console.error("❌ checkPoolRewardEligibility error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};



/* =====================================================
   ROOT UHID ACCESS CONTROL
   true  = allowed
   false = blocked
===================================================== */

const ROOT_UHID_ACCESS = {
  // "1757359069852": false, // ❌ root self blocked, team allowed
  // "1753898284391": true,  // ✅ root + team allowed
};


const checkRedeemEligibility = async (req, res) => {
  try {
    const userId = req.user._id;

    /* ==========================
       STEP 1: Fetch user data
    ========================== */
    const user = await User.findById(
      userId,
      { uhid: 1, xRank: 1 }
    ).lean();

    if (!user?.uhid) {
      return res.json({
        success: true,
        eligible: false,
        reason: "UHID_NOT_FOUND",
      });
    }

    const userUhid = String(user.uhid);

    /* ======================================================
       STEP 2: TEAM CHECK (PRIMARY – NO CHANGE)
       If in allowed team → ALLOW & EXIT
    ====================================================== */
    const allRootUhids = Object.keys(ROOT_UHID_ACCESS);

    if (allRootUhids.length) {
      const isInAnyRootTeam = await Level.exists({
        parent: { $in: allRootUhids },
        child: userUhid,
      });

      if (isInAnyRootTeam) {
        return res.json({
          success: true,
          eligible: true,
          reason: "TEAM_ALLOWED",
        });
      }
    }

    /* ======================================================
       STEP 3: XRANK CHECK (REST USERS)
       X1 users are always disabled
    ====================================================== */
    if (user.xRank === "X1") {
      return res.json({
        success: true,
        eligible: false,
        reason: "XRANK_X1_BLOCKED",
      });
    }

    /* ======================================================
       STEP 4: ON-CHAIN CHECK (REST USERS)
       Withdrawals > Deposits → DISABLE
    ====================================================== */
    const {
      totalDeposits,
      totalWithdrawals,
    } = await getUserChainTotals(userId);

    if (Number(totalWithdrawals) > Number(totalDeposits)) {
      return res.json({
        success: true,
        eligible: false,
        reason: "WITHDRAWAL_GT_DEPOSIT",
        meta: {
          totalDeposits,
          totalWithdrawals,
        },
      });
    }

    /* ======================================================
       STEP 5: FINAL ALLOW
    ====================================================== */
    return res.json({
      success: true,
      eligible: false,
      reason: "ELIGIBLE_STANDARD_USER",
    });

  } catch (error) {
    console.error("Redeem eligibility check failed:", error);
    return res.status(500).json({
      success: false,
      eligible: false,
      reason: "SERVER_ERROR",
    });
  }
};




module.exports = {
  getLedgerDetails,
  getLedgerHistory,
  addLpFromUsdt,
  transferLpToUsdt,
  transferRewardsToUsdt,
  getLedgerEventTypes,
  withdrawUSDT,
  getWithdrawalsHistory,
  walletHistory,
  getLedgerLevelRewards,
  CommunityRewardsHistory,
  startAutoPositioningCron,
  runAutopositioningForUser,
  reports,
  usersReports,
  addLpFromCommuntityRewards,
  getTeamDailyLedgerTotals,
  checkPoolRewardEligibility,
  checkRedeemEligibility
};
