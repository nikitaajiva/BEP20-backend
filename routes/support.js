const express = require("express");
const router = express.Router();
const { protect, isSupportOrAdmin } = require("../middleware/authMiddleware");
const {
  getUsers,
  getLedger,
  getLedgerRows,
  getUsdtDeposits,
  getUsdtClaimed,
  getUsdtRedeemed,
  getlppositioning,
  getUsdtAutopositioning,
  grantManualBonus,
  grantManualAirdrop,
  updateLedger,
  deleteUser,
  getUsersSummary,
  getUsersSummaryDetail,
  getUsdtWithdrawals,
  getSystemReport,
  getEcofeeReport,
  getUsdtReport,
  getUsersUsdtBalancesFromLedger,
  getAutopositioningReport,
  addFailedUsdtDepositsToUsdt,
  getUsersAutopositioningTotals,
  getUsersEcosystemFeeTotals,
  getUsdtTransactionDetails,
  getUsersx1reawards,
  getpositivelp,
  exportPositiveLP,
  getActiveLp,
  exportActiveLp,
  getUserX1Rewards,
  getWithdrawalErrored,
  get5xrewards,
  export5xrewards,
  getBooster,
  exportBoosterrewards,
  getUsdt,
  exportUsdt,
  getAutopositioningWallet,
  getOnChainWithdrawalsGreaterThanDeposits,
  getOnChainDepositsGreaterThanWithdrawals,
  getAirdrop,
  exportAirdroprewards,
  getDailyRewardsReport,
  exportDailyRewards,
  getDailyRewardsByType,
  exportDailyRewardsByType,
  getAdjustment,
  updateAdjustment,
  deleteAdjustment,

  // ✅ NEW controller function
} = require("../controllers/supportController");

// All routes in this file will be protected and restricted to support/admin
router.use(protect);
router.use(isSupportOrAdmin);

// Define routes
router.get("/users", getUsers);
router.get("/ledger", getLedger);
router.get("/ledger-rows", getLedgerRows);
router.get("/usdt-deposits", getUsdtDeposits);
router.post("/manual-bonus", grantManualBonus);
router.post("/manual-airdrop", grantManualAirdrop);
router.put("/ledger", updateLedger);
router.delete("/users/:userId", deleteUser);
router.get("/users-summary", getUsersSummary);
router.get("/users-summary/detail", getUsersSummaryDetail);
router.get("/usdt-withdrawals", getUsdtWithdrawals);
router.get("/usdt-claimed", getUsdtClaimed);
router.get("/usdt-redeemed", getUsdtRedeemed);
router.get("/positivelp", getpositivelp);
router.get("/positivelp/export", exportPositiveLP);
router.get("/activeLp", getActiveLp);
router.get("/activeLp/export", exportActiveLp);
router.get("/boost", getBooster);
router.get("/boost/export", exportBoosterrewards);
router.get("/daily-rewards", getDailyRewardsReport);
router.get("/daily-rewards/export", exportDailyRewards);
router.get("/daily-rewards/:type/export", exportDailyRewardsByType);
router.get("/daily-rewards/:type", getDailyRewardsByType);
router.get("/usdt", getUsdt);
router.get("/usdt/export", exportUsdt);
router.get("/autopositioning-wallets", getAutopositioningWallet);
router.get("/withdrawals-greater", getOnChainWithdrawalsGreaterThanDeposits);
router.get("/deposits-greater", getOnChainDepositsGreaterThanWithdrawals);
router.get("/airdrop", getAirdrop);
router.get("/airdrop/export", exportAirdroprewards);
router.get("/5xrewards", get5xrewards);
router.get("/5xrewards/export", export5xrewards);
router.get("/usdt-autopositioning", getUsdtAutopositioning);
router.get("/lp-positioning", getlppositioning);
router.get("/usdt-withdrawalerror", getWithdrawalErrored);

router.get("/system-report", getSystemReport);

router.get("/system-report-autopositioning", getAutopositioningReport);
router.get(
  "/system-report-autopositioning-users",
  getUsersAutopositioningTotals
);

router.get("/system-report-usdt", getUsdtReport);
router.get("/system-report-usdt-users", getUsersUsdtBalancesFromLedger);
router.get("/system-report-x1reawards", getUsersx1reawards);
router.get("/system-report-x1reawards-users", getUserX1Rewards);

router.get("/system-report-ecofee", getEcofeeReport);
router.get("/system-report-ecofee-users", getUsersEcosystemFeeTotals);

router.post("/usdt-deposits/transaction", getUsdtTransactionDetails);

// Add failed USDT deposits to USDT wallet & ledger
router.post("/usdt-deposits/add-to-usdt", addFailedUsdtDepositsToUsdt);

// Settings (single document)
router.get("/settings", getAdjustment);
router.post("/settings", updateAdjustment);
router.put("/settings", updateAdjustment);
router.delete("/settings", deleteAdjustment);

module.exports = router;

