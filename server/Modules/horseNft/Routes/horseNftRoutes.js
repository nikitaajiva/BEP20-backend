const express = require("express");
const {
  getPublicHorseNftPackages,
  purchaseHorseNft,
  getMyHorseNfts,
  getMyHorseNftById,
  getMyHorseNftPayoutHistory,
} = require("../Controllers/horseNftController");
const {
  protect,
  blockDuringCron,
} = require("../../../../middleware/authMiddleware");

const router = express.Router();

router.get("/packages", getPublicHorseNftPackages);
router.post("/purchase", protect, blockDuringCron, purchaseHorseNft);
router.get("/my", protect, getMyHorseNfts);
router.get("/my/:id", protect, getMyHorseNftById);
router.get("/payout-history", protect, getMyHorseNftPayoutHistory);

module.exports = router;
