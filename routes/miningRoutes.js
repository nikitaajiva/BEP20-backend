const express = require("express");
const { getMyMiningSummary, getMyMiningHistory } = require("../controllers/miningController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my-summary", protect, getMyMiningSummary);
router.get("/my-history", protect, getMyMiningHistory);

module.exports = router;
