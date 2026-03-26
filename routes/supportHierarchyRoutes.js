const express = require('express');
const router = express.Router();
const { getTopLevelUsers, getDescendants } = require('../controllers/supportHierarchyController');
const { protect: authMiddleware, isSupportOrAdmin: isAdminOrSupport } = require('../middleware/authMiddleware');

// Note: All routes in this file are already prefixed with /api/support/hierarchy

// GET /api/support/hierarchy/top-level
// Fetches users who are at the top of the hierarchy (no sponsor)
router.get('/top-level', authMiddleware, isAdminOrSupport, getTopLevelUsers);

// GET /api/support/hierarchy/descendants/:uhid
// Fetches the direct descendants (children) of a given user by their UHID
router.get('/descendants/:uhid', authMiddleware, isAdminOrSupport, getDescendants);

module.exports = router; 