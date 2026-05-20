const express = require("express");
const {
  getAdminHorseNftPackages,
  seedHorseNftPackages,
  updateHorseNftPackage,
  getAdminHorseNftPurchases,
  getAdminHorseNftPayouts,
  runAdminHorseNftPayout,
} = require("../Controllers/adminHorseNftController");
const {
  protect,
  authorize,
} = require("../../../../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.use(authorize("admin", "superadmin"));

router.get("/packages", getAdminHorseNftPackages);
router.post("/packages/seed", seedHorseNftPackages);
router.put("/packages/:tierCode", updateHorseNftPackage);
router.get("/purchases", getAdminHorseNftPurchases);
router.get("/payouts", getAdminHorseNftPayouts);
router.post("/run-payout", runAdminHorseNftPayout);

module.exports = router;
