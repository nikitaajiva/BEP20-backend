const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
const User = require("../models/User");
const Ledger = require("../models/Ledger");
const Level = require("../models/Level");

const ROOT = process.argv[2];

if (!ROOT) {
  console.error("❌ Usage: node scripts/resetTeamWallets.js <ROOT_UHID>");
  process.exit(1);
}

async function getAllUHIDs(root) {
  const set = new Set([root]);
  let queue = [root];

  while (queue.length) {
    const children = await Level.find(
      { parent: { $in: queue } },
      { child: 1, _id: 0 }
    );

    queue = [];

    for (const row of children) {
      if (!set.has(row.child)) {
        set.add(row.child);
        queue.push(row.child);
      }
    }
  }

  return [...set];
}

async function main() {
  await connectDB();
  console.log("✅ DB Connected");

  const uhids = await getAllUHIDs(ROOT);
  console.log("👥 Total team size:", uhids.length);

  const users = await User.find({ uhid: { $in: uhids } }).select("_id uhid");
  const userIds = users.map(u => u._id);

  // Lock withdrawals
  await Ledger.updateMany(
    { userId: { $in: userIds } },
    { $set: { withdrawalDisabled: true } }
  );

  // Reset wallets
  const result = await Ledger.updateMany(
    { userId: { $in: userIds } },
    {
      $set: {
        "wallets.lp": 0.0,
        "wallets.zeroRisk": 0.0,
        "wallets.xaman": 0.0,
        "wallets.communityRewards": 0.0
      }
    }
  );

  console.log("🔒 Withdrawals locked");
  console.log("💣 Wallets reset to 0.0");
  console.log("🧾 Ledgers modified:", result.modifiedCount);

  process.exit(0);
}

main().catch(err => {
  console.error("❌ ERROR:", err);
  process.exit(1);
});
