const express = require("express");
const router = express.Router();
const {
  descendants,
  descendantsAtLevel,
  sponsor,
  uplineAtLevel,
  searchUsername,
  getSelfLpSumUpToLevel,
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

    console.log("▶️ [START] /users/:uhid/descendants route hit");
    console.log("📌 Request Params UHID:", paramUhid);
    console.log("📌 Query - viewerUhid:", viewerUhid, "| search:", search);

    let targetUhid = paramUhid;
    let user = null;
    let result = [];

    if (search && search.trim() !== "") {
      console.log("🔍 Performing search for username:", search.trim());

      user = await searchUsername(search.trim(), paramUhid);
      console.log("🔎 Search Result (user):", user);

      if (user && user.uhid) {
        targetUhid = user.uhid;
        console.log("✅ User found in team. Using targetUhid:", targetUhid);

        // 1. Get descendants under searched user
        const descendantsList = await descendants(targetUhid, viewerUhid);
        console.log(
          "📥 Descendants fetched for searched user:",
          descendantsList.length
        );

        // 2. Get full list from original parent to extract full user data
        const fullTree = await descendants(paramUhid, viewerUhid);

        // 3. Try to find complete descendant object for the searched user
        const fullUserData = fullTree.find((d) => d.uhid === targetUhid);

        let mergedUserData = {
          _id: user._id,
          uhid: user.uhid,
          username: user.username,
          registrationTs: user.registrationTs,
          teamSize: 0,
          selfLp: 0,
          teamLp: 0,
          country: user.country || "N/A",
          sponsorUsername: user.sponsorUsername || "N/A",
          whatsappContact: user.whatsappContact || "N/A",
        };

        if (fullUserData) {
          mergedUserData = {
            ...mergedUserData,
            teamSize: fullUserData.teamSize || 0,
            selfLp: fullUserData.selfLp || 0,
            teamLp: fullUserData.teamLp || 0,
            country:
              fullUserData.country?.name || fullUserData.country || "N/A",
            sponsorUsername: fullUserData.sponsorUsername || "N/A",
            whatsappContact: fullUserData.whatsappContact || "N/A",
          };
        } else {
          console.warn("⚠️ Full user data not found in parent descendants.");
        }

        // 4. Merge with current descendants list
        const isAlreadyIncluded = descendantsList.some(
          (d) => d.uhid === targetUhid
        );

        const updatedDescendants = isAlreadyIncluded
          ? descendantsList.map((d) =>
              d.uhid === targetUhid ? mergedUserData : d
            )
          : [mergedUserData, ...descendantsList];

        result = updatedDescendants;
        console.log("📌 Full user data merged correctly.");
      } else {
        console.warn("⚠️ User not found or not in team.");
        return res.json({ user: null, uhid: null, descendants: [] });
      }
    } else {
      console.log("📤 No search keyword, fetching normal descendants...");
      result = await descendants(paramUhid, viewerUhid);
      console.log("📥 Descendants fetched:", result.length);
    }

    console.log("✅ Sending response with uhid:", targetUhid);
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
      let user = null;

      if (search && search.trim() !== "") {
        user = await searchUsername(search.trim());
        if (user && user.uhid) {
          targetUhid = user.uhid;
        } else {
          // if not found, send empty result or error
          return res.json({
            user: null,
            uhid: null,
            level: levelN,
            descendants_at_level: [],
          });
        }
      }
      const result = await descendantsAtLevel(targetUhid, levelN, viewerUhid);
      const levelSelfLpSum = await getSelfLpSumUpToLevel(
        targetUhid,
        levelN,
        viewerUhid
      );
      console.log("levelSelfLpSum", levelSelfLpSum);
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
