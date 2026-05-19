const express = require("express");
const { adjustTokenBalance } = require("../controllers/adminTokenLedgerController");
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/adjust", protect, authorize("admin", "superadmin"), adjustTokenBalance);

module.exports = router;
