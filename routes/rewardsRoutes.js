const express = require("express");
const router = express.Router();
const {
  getCascadeRewards,
  getBoosterRewards,
  getNodeRewards,
  getAirdropPoolStats,
  getAirdropPoolHistory,
} = require("../controllers/rewardsController");
const { protect, blockDuringCron } = require("../middleware/authMiddleware"); // Assuming you have this middleware

// @route   GET /api/ledger
// @desc    Get ledger details (Swift, Boost, FiveX, ZeroRisk limits and pending amounts) for the authenticated user
// @access  Private
router.get("/cascade", protect, getCascadeRewards);
router.get("/booster", protect, getBoosterRewards);
router.get("/node", protect, getNodeRewards);

// Airdrop Pool (P1-P9 Node Tier Rewards)
router.get("/airdrop-pool", protect, getAirdropPoolStats);
router.get("/airdrop-pool/history", protect, getAirdropPoolHistory);

module.exports = router;

