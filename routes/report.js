const express = require("express");
const router = express.Router();
const { generateUserReport } = require("../controllers/reportController");


const { protect,isSupportOrAdmin } = require("../middleware/authMiddleware"); // Assuming you have this middleware

// @route   GET /api/ledger
// @desc    Get ledger details (Swift, Boost, FiveX, ZeroRisk limits and pending amounts) for the authenticated user
// @access  Private
router.get("/generate-user-report", protect,isSupportOrAdmin, generateUserReport);
module.exports = router;
