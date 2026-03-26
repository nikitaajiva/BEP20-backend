require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Ledger = require("../models/Ledger");
const { runAutopositioningForUser } = require("../controllers/ledgerController");

(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected successfully");

    const BLOCKED_UHIDS = [
      1753898284391,
      1758789312402,
      1757359069852,
      1765813521617,
    ];

    console.log("🚀 Manual AutoPositioning started");

    /* ===============================
       IMPORTANT FIX: FULL USER DOC
    ================================ */
    const users = await User.find({ xRank: "X1" }); // ❗ NO lean(), NO projection

    if (!users.length) {
      console.log("⚠️ No X1 users found");
      return;
    }

    console.log(`📋 Found ${users.length} users with xRank X1`);

    for (const user of users) {
      if (BLOCKED_UHIDS.includes(Number(user.uhid))) {
        console.log(
          `⏭ SKIPPED (blocked UHID): ${user.username} (${user.uhid})`
        );
        continue;
      }

      const ledger = await Ledger.findOne({
        userId: user._id,
        withdrawalDisabled: true,
      });

      if (!ledger) {
        console.log(
          `⏭ SKIPPED (withdrawalDisabled false): ${user.username}`
        );
        continue;
      }

      console.log(
        `⚙️ Running autopositioning for: ${user.username} (${user._id})`
      );

      await runAutopositioningForUser(user); // ✅ now works
    }

    console.log("✅ Manual AutoPositioning completed successfully");
  } catch (err) {
    console.error("❌ Error during manual autopositioning:", err);
  } finally {
    mongoose.connection.close();
  }
})();
