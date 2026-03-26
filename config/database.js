const mongoose = require("mongoose");
require("dotenv").config();

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  throw new Error("❌ MONGODB_URI missing in .env – cannot start server.");
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // fail fast if unreachable
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error(`❌ Error connecting to MongoDB: ${err.message}`);
    process.exit(1);
  }
};

module.exports = {
  connectDB,
  MONGO_URI,
};
