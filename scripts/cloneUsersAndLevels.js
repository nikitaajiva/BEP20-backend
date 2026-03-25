/**
 * CLONE users + levels COLLECTIONS
 * ---------------------------------------
 * From SOURCE MongoDB → TARGET MongoDB
 *
 * Usage:
 *   node scripts/cloneUsersAndLevels.js
 *
 * Env required:
 *   SOURCE_MONGO_URI=
 *   TARGET_MONGO_URI=
 */

require("dotenv").config();
const mongoose = require("mongoose");

/* ===============================
   CONFIG
================================ */
const SOURCE_URI = process.env.MONGODB_URI;
const TARGET_URI = process.env.TARGET_MONGO_URI;

const BATCH_SIZE = 1000;
const CLEAN_TARGET = true; // set false if you DON'T want to wipe target collections

if (!SOURCE_URI || !TARGET_URI) {
  console.error("❌ Missing SOURCE_MONGO_URI or TARGET_MONGO_URI");
  process.exit(1);
}

/* ===============================
   CONNECT HELPERS
================================ */
const connect = (uri, label) =>
  mongoose.createConnection(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }).asPromise()
    .then(conn => {
      console.log(`✅ Connected to ${label}`);
      return conn;
    });

/* ===============================
   CLONE FUNCTION
================================ */
async function cloneCollection({ sourceDb, targetDb, name }) {
  console.log(`\n📦 Cloning collection: ${name}`);

  const sourceCol = sourceDb.collection(name);
  const targetCol = targetDb.collection(name);

  if (CLEAN_TARGET) {
    await targetCol.deleteMany({});
    console.log(`🧹 Cleared target ${name}`);
  }

  const cursor = sourceCol.find({});
  let batch = [];
  let total = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      await targetCol.insertMany(batch, { ordered: false });
      total += batch.length;
      console.log(`➡️ ${name}: ${total} docs copied`);
      batch = [];
    }
  }

  if (batch.length) {
    await targetCol.insertMany(batch, { ordered: false });
    total += batch.length;
  }

  console.log(`✅ Finished ${name}: ${total} documents cloned`);
}

/* ===============================
   MAIN
================================ */
async function main() {
  let sourceConn, targetConn;

  try {
    sourceConn = await connect(SOURCE_URI, "SOURCE DB");
    targetConn = await connect(TARGET_URI, "TARGET DB");

    const sourceDb = sourceConn.db;
    const targetDb = targetConn.db;

//    await cloneCollection({ sourceDb, targetDb, name: "users" });
//    await cloneCollection({ sourceDb, targetDb, name: "levels" });
  await cloneCollection({ sourceDb, targetDb, name: "countries" });

    console.log("\n🎉 CLONE COMPLETED SUCCESSFULLY");
  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    if (sourceConn) await sourceConn.close();
    if (targetConn) await targetConn.close();
    process.exit(0);
  }
}

main();
