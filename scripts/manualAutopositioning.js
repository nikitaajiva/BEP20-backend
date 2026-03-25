require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Level = require("../models/Level");
const { runAutopositioningForUser } = require("../controllers/ledgerController");

/* ======================================================
   ROOT & BLOCKED CONFIG
====================================================== */
const ROOT_UHID_ACCESS = {
  "1757359069852": true,
  "1753898284391": true,
};

const BLOCKED_UHIDS = [
  1753898284391,
  1758789312402,
  1757359069852,
  1765813521617,
];

/* ======================================================
   STANDARD USER CHECK
====================================================== */
async function isStandardUser(user) {
  if (!user?.uhid) return false;

  const userUhid = String(user.uhid);
  const rootUhids = Object.keys(ROOT_UHID_ACCESS);

  // ❌ ROOT USER
  if (rootUhids.includes(userUhid)) {
    return false;
  }

  // ❌ TEAM USER (under any root)
  const isTeamMember = await Level.exists({
    parent: { $in: rootUhids },
    child: userUhid,
  });

  if (isTeamMember) {
    return false;
  }

  return true; // ✅ STANDARD USER
}

/* ======================================================
   MAIN
====================================================== */
(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected successfully");
    console.log("🚀 Manual AutoPositioning started");

    const users = await User.find({ autopositioning: true });

    if (!users.length) {
      console.log("⚠️ No users found with autopositioning enabled");
      return;
    }

    console.log(`📋 Found ${users.length} users with autopositioning enabled`);

    for (const user of users) {
      // 🔒 BLOCKED UHID CHECK
      if (BLOCKED_UHIDS.includes(Number(user.uhid))) {
        console.log(
          `⏭ SKIPPED (BLOCKED) user: ${user.username} (UHID: ${user.uhid})`
        );
        continue;
      }

      // 🔒 STANDARD USER CHECK
      const standardUser = await isStandardUser(user);

      if (!standardUser) {
        console.log(
          `⏭ SKIPPED (NON-STANDARD) user: ${user.username} (UHID: ${user.uhid})`
        );
        continue;
      }

      // ✅ SAFE TO RUN
      console.log(
        `⚙️ Running autopositioning for STANDARD user: ${user.username} (${user._id})`
      );

      await runAutopositioningForUser(user);
    }

    console.log("✅ Manual AutoPositioning completed successfully.");
  } catch (err) {
    console.error("❌ Error during manual autopositioning:", err);
  } finally {
    await mongoose.connection.close();
  }
})();
