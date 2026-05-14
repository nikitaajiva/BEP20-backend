const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  createPhantomDepositIntent,
  confirmPhantomDeposit,
  getPhantomDepositStatus,
} = require("../controllers/phantomDepositController");

// All routes are protected
router.use(protect);

router.post("/intent", createPhantomDepositIntent);
router.post("/confirm", confirmPhantomDeposit);
router.get("/status/:intentId", getPhantomDepositStatus);

module.exports = router;
