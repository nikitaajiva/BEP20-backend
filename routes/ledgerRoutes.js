const express = require("express");
const router = express.Router();
const {
  getLedgerDetails,
  CommunityRewardsHistory,
  getLedgerHistory,
  addLpFromUsdt,
  transferLpToUsdt,
  transferRewardsToUsdt,
  getLedgerEventTypes,
  getDailyRewardLogs,
  getTeamStats,
  walletHistory,
  reports,
  usersReports,
  addLpFromCommuntityRewards,
  getTeamDailyLedgerTotals,
  checkPoolRewardEligibility,
  checkRedeemEligibility
} = require("../controllers/ledgerController");
const { protect, blockDuringCron } = require("../middleware/authMiddleware"); // Assuming you have this middleware

// @route   GET /api/ledger
// @desc    Get ledger details (Swift, Boost, FiveX, ZeroRisk limits and pending amounts) for the authenticated user
// @access  Private
router.get("/", protect, getLedgerDetails);

// @route   GET /api/ledger/history
// @desc    Get ledger history (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/history", protect, getLedgerHistory);

// @route   GET /api/ledger/transactions
// @desc    Get ledger transactions (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/transactions", protect, walletHistory);
// @route   GET /api/ledger/reports
// @desc    Get ledger transactions (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/reports", protect, reports);

// @route   GET /api/ledger/all
// @desc    Get ledger transactions (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/all", protect, usersReports);

// @route   GET /api/ledger/team-daily-totals
// @desc    Get team ledger transactions total (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/team-daily-totals", protect, getTeamDailyLedgerTotals);

// @route   GET /api/ledger/checkPoolRewardEligibility
// @desc    Get team ledger transactions total (transactions, rewards, etc.) for the authenticated user
// @access  Private
router.get("/checkPoolRewardEligibility", protect, checkPoolRewardEligibility); 
router.get("/community-rewards", protect, CommunityRewardsHistory);

// @route   GET /api/ledger/history/event-types
// @desc    Get all distinct ledger event types for the authenticated user
// @access  Private
router.get("/history/event-types", protect, getLedgerEventTypes);
// @route   POST /api/ledger/autopositioning
// @desc    Transfer from USDT wallet to LP wallet and set limits (first time only)
// @access  Private
router.post("/autopositioning", protect, blockDuringCron, addLpFromCommuntityRewards);

// @route   POST /api/ledger/add-lp
// @desc    Transfer from USDT wallet to LP wallet and set limits (first time only)
// @access  Private
router.post("/add-lp", protect,blockDuringCron, addLpFromUsdt);

// @route   POST /api/ledger/transfer-lp-to-usdt
// @desc    Transfer funds from LP wallet to USDT wallet
// @access  Private
router.post("/transfer-lp-to-usdt", protect, blockDuringCron, transferLpToUsdt);

// @route   POST /api/ledger/transfer-rewards-to-usdt
// @desc    Transfer funds from Community Rewards wallet to USDT wallet
// @access  Private
router.post("/transfer-rewards-to-usdt", protect, blockDuringCron, transferRewardsToUsdt);


// @route   GET /api/ledger/redeem-eligibility
// @desc    Get redeem-eligibility for the authenticated user
// @access  Private
router.get("/redeem-eligibility", protect, checkRedeemEligibility);

// @desc    Get daily aggregated reward logs for the authenticated user
// @route   GET /api/ledger/level-rewards
// @access  Private
//router.get('/level-rewards', protect, getDailyRewardLogs);

// @desc Get team stats for the authenticated user
// @route GET /api/ledger/team-stats
//router.get('/team-stats', protect, getTeamStats);

module.exports = router;
