const express = require('express');
const router = express.Router();
const adminProtocolController = require('../controllers/adminProtocolController');
const { protect, authorize } = require('../middleware/authMiddleware');

// All protocol config APIs are protected to admin & superadmin
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// Protocol configuration routes
router.route('/config')
  .get(adminProtocolController.getProtocolConfig)
  .put(adminProtocolController.updateProtocolConfig);

// NFT Tiers routes
router.route('/nft-tiers')
  .get(adminProtocolController.getNftTiers);

router.route('/nft-tiers/:code')
  .put(adminProtocolController.updateNftTier);

// Node Levels routes
router.route('/node-levels')
  .get(adminProtocolController.getNodeLevels);

router.route('/node-levels/:code')
  .put(adminProtocolController.updateNodeLevel);

module.exports = router;
