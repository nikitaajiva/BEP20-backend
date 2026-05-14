const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All routes here should be protected and only for admins/superadmins
router.use(protect);
router.use(authorize('admin', 'superadmin'));

router.get('/', configController.getConfig);
router.post('/', configController.updateConfig);

module.exports = router;
