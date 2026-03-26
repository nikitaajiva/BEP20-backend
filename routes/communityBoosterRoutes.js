const express = require("express");
const router = express.Router();
const { protect, isSupportOrAdmin } = require("../middleware/authMiddleware");

const {
  getBoosterSummary,
  getBoosterDetails,
  // getRewardsSummary,
  getCascadeSnapshot,
} = require("../controllers/communityBoosterController");

// All routes here require support/admin access
router.use(protect, isSupportOrAdmin);

// Community Booster
// GET /api/bonus/community/summary
router.get("/summary", getBoosterSummary);

// GET /api/bonus/community/details
router.get("/details", getBoosterDetails);

// Cascade snapshot (strict >9 LP, matches job debug output)
// GET /api/bonus/community/cascade/snapshot?sponsor=<uhid|username>&level=<1-16 optional>
router.get("/cascade/snapshot", getCascadeSnapshot);

module.exports = router;
