const express = require("express");
const { runDailyMining } = require("../controllers/miningController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// Restrict to admins and superadmins
router.post("/run-daily", protect, authorize("admin", "superadmin"), runDailyMining);

module.exports = router;
