const express = require("express");
const router = express.Router();
const {
  descendants,
  descendantsAtLevel,
  sponsor,
  uplineAtLevel,
  searchUsername,
  getSelfLpSumUpToLevel,
  fetchAndMergeReferralData,
} = require("../utils/hierarchyUtils.js"); // CommonJS require

// Middleware for common UHID validation
const validateUhId = (req, res, next) => {
  if (!req.params.uhid) {
    return res.status(400).json({ error: "UHID parameter is required" });
  }
  next();
};

// Middleware for levelN validation
const validateLevelN = (req, res, next) => {
  const levelN = parseInt(req.params.levelN, 10);
  if (isNaN(levelN) || levelN < 1) {
    return res
      .status(400)
      .json({ error: "Valid LevelN parameter (positive integer) is required" });
  }
  req.params.levelN = levelN; // Ensure it's a number
  next();
};

// 1. Find direct descendants of a UHID
// GET /api/hierarchy/users/:uhid/descendants
router.get("/users/:uhid/descendants", validateUhId, async (req, res, next) => {
  try {
    const { uhid: paramUhid } = req.params;
    const { viewerUhid, search } = req.query;

    let targetUhid = paramUhid;
    let user = null;
    let result = [];

    if (search && search.trim() !== "") {
      // 1. Try to find the user globally in this user's tree first (drill-down support)
      user = await searchUsername(search.trim(), paramUhid);
      
      if (user && user.uhid) {
        targetUhid = user.uhid;
        
        // Fetch direct descendants of the found user
        const descendantsList = await descendants(targetUhid, viewerUhid);
        
        // Also fetch the searched user's own data to include at the top
        const searchedUserData = await fetchAndMergeReferralData([targetUhid], 0, viewerUhid, paramUhid);
        const mergedUserData = searchedUserData[0] || {
          _id: user._id,
          uhid: user.uhid,
          username: user.username,
          registrationTs: user.registrationTs,
          teamSize: 0,
          selfLp: 0,
          teamLp: 0,
          country: "N/A",
          sponsorUsername: "N/A",
          whatsappContact: "N/A"
        };

        // Put searched user at the top, then their direct team
        result = [mergedUserData, ...descendantsList];
      } else {
        // If not found in tree, try filtering direct descendants by username
        result = await descendants(paramUhid, viewerUhid, search);
      }
    } else {
      result = await descendants(paramUhid, viewerUhid);
    }

    res.json({
      user,
      uhid: targetUhid,
      descendants: result,
    });
  } catch (err) {
    console.error(`❌ Error in /users/${req.params.uhid}/descendants:`, err);
    next(err);
  }
});

// 2. Find descendants of a UHID at a specific level
// GET /api/hierarchy/users/:uhid/descendants/level/:levelN
router.get(
  "/users/:uhid/descendants/level/:levelN",
  validateUhId,
  validateLevelN,
  async (req, res, next) => {
    try {
      const { uhid: paramUhid, levelN } = req.params;
      const { viewerUhid, search } = req.query;

      let targetUhid = paramUhid;
      
      // If search is provided, we filter descendants at this level
      // Note: We don't do drill-down for specific level requests as it's confusing
      const result = await descendantsAtLevel(targetUhid, levelN, viewerUhid, search);
      
      const levelSelfLpSum = await getSelfLpSumUpToLevel(
        targetUhid,
        levelN,
        viewerUhid
      );
      
      res.json({
        uhid: targetUhid,
        level: levelN,
        levelSelfLpSum,
        descendants_at_level: result,
      });
    } catch (err) {
      console.error(
        `Error in /users/${req.params.uhid}/descendants/level/${req.params.levelN}:`,
        err
      );
      next(err);
    }
  }
);

// 3. Find sponsor of a UHID
// GET /api/hierarchy/users/:uhid/sponsor
router.get("/users/:uhid/sponsor", validateUhId, async (req, res, next) => {
  try {
    const { uhid } = req.params;
    const result = await sponsor(uhid);
    if (result) {
      res.json({ uhid, sponsor: result });
    } else {
      res
        .status(404)
        .json({ uhid, message: "Sponsor not found or user is a root user." });
    }
  } catch (err) {
    console.error(`Error in /users/${req.params.uhid}/sponsor:`, err);
    next(err);
  }
});

// 4. Find upline of a UHID at a specific level
// GET /api/hierarchy/users/:uhid/upline/level/:levelN
router.get(
  "/users/:uhid/upline/level/:levelN",
  validateUhId,
  validateLevelN,
  async (req, res, next) => {
    try {
      const { uhid, levelN } = req.params;
      const result = await uplineAtLevel(uhid, levelN);
      if (result) {
        res.json({ uhid, level: levelN, upline_at_level: result });
      } else {
        res.status(404).json({
          uhid,
          level: levelN,
          message:
            "Upline at specified level not found or user is too high in hierarchy.",
        });
      }
    } catch (err) {
      console.error(
        `Error in /users/${req.params.uhid}/upline/level/${req.params.levelN}:`,
        err
      );
      next(err);
    }
  }
);

module.exports = router;
