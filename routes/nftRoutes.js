const express = require("express");
const {
  getPublicNftTiers,
  mintNft,
  purchaseMiningNft,
  getMyNfts,
  getMyNftById,
  stakeMyNft,
  unstakeMyNft,
  getMyStakedNfts,
} = require("../controllers/nftController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/tiers", protect, getPublicNftTiers);
router.post("/mint", protect, mintNft);
router.post("/purchase", protect, purchaseMiningNft);
router.get("/my", protect, getMyNfts);
router.get("/staked", protect, getMyStakedNfts);
router.get("/my/:id", protect, getMyNftById);

router.post("/:id/stake", protect, stakeMyNft);
router.post("/:id/unstake", protect, unstakeMyNft);

module.exports = router;
