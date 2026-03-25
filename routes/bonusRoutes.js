const express = require('express');
const router = express.Router();

const { protect, isSupportOrAdmin } = require('../middleware/authMiddleware');
const bonusController = require('../controllers/bonusController');
const communityBoosterRoutes = require('./communityBoosterRoutes');
const x1BonusRoutes = require('./x1BonusRoutes');

// All routes here require support/admin access
router.use(protect, isSupportOrAdmin);

// Mount community booster routes
router.use('/community', communityBoosterRoutes);

// Mount X1 bonus routes
router.use('/x1', x1BonusRoutes);

// GET /api/bonus/summary
router.get('/summary', bonusController.getBonusSummary);

// GET /api/bonus/details/team
router.get('/details/team', bonusController.getTeamDetails);

// GET /api/bonus/details/events
router.get('/details/events', bonusController.getEventDetails);

module.exports = router; 