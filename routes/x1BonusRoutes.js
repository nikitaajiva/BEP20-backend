const express = require('express');
const router = express.Router();
const { protect, isSupportOrAdmin } = require('../middleware/authMiddleware');
const x1BonusController = require('../controllers/x1BonusController');

// All routes here require support/admin access
router.use(protect, isSupportOrAdmin);

// GET /api/bonus/x1/summary
router.get('/summary', x1BonusController.getX1Summary);

// GET /api/bonus/x1/details
router.get('/details', x1BonusController.getX1Details);

module.exports = router; 