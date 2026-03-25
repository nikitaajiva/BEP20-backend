/**
 * Script: fixFailedZeroRiskRowsByDate.js
 * Purpose:
 *  - Fix FAILED ZERO_RISK → EXTERNAL ledger rows
 *  - Strict UTC date bound
 *  - Optional DRY_RUN mode
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { execSync } = require("child_process");
const connectDB = require("../config/db");

// Models
const LedgerRow = require("../models/LedgerRow");
const User = require("../models/User");

// ---------------- CONFIG ----------------
const DRY_RUN = process.env.DRY_RUN === "true";

// 🔴 CHANGE DATE RANGE BEFORE RUNNING (UTC)
const START = new Date("2026-01-01T00:00:00.000Z");
const END   = new Date("2026-01-11T00:00:00.000Z");

// ---------------- MAIN ----------------
const run = async () => {
  await connectDB();

  console.log("🚀 Fixing FAILED ZERO_RISK LedgerRows");
  console.log(`🗓 Range: ${START.toISOString()} → ${END.toISOString()}`);
  console.log(`🧪 DRY_RUN: ${DRY_RUN}\n`);

  try {
    // 1️⃣ Find affected users (date-bound)
    const userIds = await LedgerRow.distinct("userId", {
      walletFrom: "ZERO_RISK",
      walletTo: "EXTERNAL",
      status: "FAILED",
      ts: { $gte: START, $lt: END },
    });

    if (!userIds.length) {
      console.log("✅ No FAILED ZERO_RISK LedgerRows found in range");
      return;
    }

    console.log(`⚠ Found ${userIds.length} affected users\n`);

    for (const userId of userIds) {
      // 2️⃣ Get XRP address from USERS
      const user = await User.findById(userId, { xrpAddress: 1 }).lean();

      if (!user?.xrpAddress) {
        console.log(`❌ User ${userId} has no xrpAddress, skipping\n`);
        continue;
      }

      const xrpAddress = user.xrpAddress;
      console.log(`➡ Processing user ${userId} | ${xrpAddress}`);

      // 3️⃣ Count FAILED rows
      const rowsCount = await LedgerRow.countDocuments({
        userId,
        walletFrom: "ZERO_RISK",
        walletTo: "EXTERNAL",
        status: "FAILED",
        ts: { $gte: START, $lt: END },
      });

      console.log(`📌 FAILED rows to fix: ${rowsCount}`);

      if (!DRY_RUN && rowsCount > 0) {
        // 4️⃣ Delete FAILED rows
        const { deletedCount } = await LedgerRow.deleteMany({
          userId,
          walletFrom: "ZERO_RISK",
          walletTo: "EXTERNAL",
          status: "FAILED",
          ts: { $gte: START, $lt: END },
        });

        console.log(`🗑 Deleted ${deletedCount} FAILED LedgerRows`);

        // 5️⃣ Re-run chain tracker
        try {
          console.log("🔁 Running chain tracker...");
          execSync(
            `node scripts/runtrackChainTx.js ${xrpAddress}`,
            { stdio: "inherit" }
          );
          console.log("✔ Chain tracker completed\n");
        } catch (err) {
          console.error(
            `❌ Chain tracker failed for user ${userId}`,
            err.message
          );
        }
      } else {
        console.log("🧪 DRY_RUN: no delete, no chain replay\n");
      }
    }
  } catch (err) {
    console.error("❌ SCRIPT ERROR:", err);
  } finally {
    await mongoose.disconnect();
    console.log("\n🎯 DATE-BOUND ZERO_RISK correction completed");
  }
};

run();
