const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../../config/db");
const run = async () => {
  await connectDB();

  try {
    const db = mongoose.connection.db;
    const collection = db.collection("cascaderewards");

    // Get today in UTC dynamically (no hard-coded dates)
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    const result = await collection.updateMany(
      {
        createdAt: { $gte: start, $lt: end },
      },
      [
        {
          $set: {
            createdAt: { $dateSubtract: { startDate: "$createdAt", unit: "day", amount: 1 } },
            updatedAt: { $dateSubtract: { startDate: "$updatedAt", unit: "day", amount: 1 } },
          },
        },
      ]
    );

    
  } catch (err) {
    console.error("❌ Error running update:", err);
  } finally {
    await mongoose.disconnect();
    
  }
};

run();
