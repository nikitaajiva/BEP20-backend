const express = require("express");
const { getMyRewardTransactions } = require("../controllers/rewardTransactionController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/my", protect, getMyRewardTransactions);

module.exports = router;
