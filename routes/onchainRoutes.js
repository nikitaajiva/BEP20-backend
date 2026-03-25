const express = require("express");
const router = express.Router();
const {
  getDetails,
  
} = require("../controllers/onchainController");
const { protect } = require("../middleware/authMiddleware"); // Assuming you have this middleware

// @route   GET /api/ledger
// @desc    Get ledger details (Swift, Boost, FiveX, ZeroRisk limits and pending amounts) for the authenticated user
// @access  Private
router.get("/", protect, getDetails);
module.exports = router;
