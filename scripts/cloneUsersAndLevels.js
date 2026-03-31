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
      
      return conn;
    });

/* ===============================
   CLONE FUNCTION
================================ */
async function cloneCollection({ sourceDb, targetDb, name }) {
  

  const sourceCol = sourceDb.collection(name);
  const targetCol = targetDb.collection(name);

  if (CLEAN_TARGET) {
    await targetCol.deleteMany({});
    
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
      
      batch = [];
    }
  }

  if (batch.length) {
    await targetCol.insertMany(batch, { ordered: false });
    total += batch.length;
  }

  
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

    
  } catch (err) {
    console.error("❌ ERROR:", err);
  } finally {
    if (sourceConn) await sourceConn.close();
    if (targetConn) await targetConn.close();
    process.exit(0);
  }
}

main();
