const express = require("express");
const {
  createPhantomDepositIntent,
  confirmPhantomDeposit,
  getPhantomDepositStatus,
} = require("../controllers/phantomDepositController");
const { protect, blockDuringCron } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/intent", protect, blockDuringCron, createPhantomDepositIntent);
router.post("/confirm", protect, blockDuringCron, confirmPhantomDeposit);
router.get("/status/:intentId", protect, blockDuringCron, getPhantomDepositStatus);

module.exports = router;
