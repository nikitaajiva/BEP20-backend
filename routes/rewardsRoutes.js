const express = require("express");
const router = express.Router();
const {
  getCascadeRewards,getBoosterRewards //,getXbonusRewards
} = require("../controllers/rewardsController");
const { protect, blockDuringCron } = require("../middleware/authMiddleware"); // Assuming you have this middleware

// @route   GET /api/ledger
// @desc    Get ledger details (Swift, Boost, FiveX, ZeroRisk limits and pending amounts) for the authenticated user
// @access  Private
router.get("/cascade", protect, getCascadeRewards);
router.get("/booster", protect, getBoosterRewards);
 // router.get("/x-bonus", protect, getXbonusRewards);



module.exports = router;
