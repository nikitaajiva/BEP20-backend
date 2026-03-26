require("dotenv").config(); // Ensure .env is loaded first
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

// --- Database Connection ---
// Assuming db.js is in project-merged/config/db.js and handles the connection
// If xrp system had a direct mongoose.connect, that logic is now centralized in db.js
const connectDB = require("./config/db");
const app = express();
app.set("trust proxy", true);

// --- Middleware ---
app.use(
  cors({
    // Example origins, adjust as per your frontend setup
    origin: [
      "http://localhost:3000",
      "http://localhost:3001" //,
      //  process.env.FRONTEND_URL_PROD,
      //  process.env.FRONTEND_URL
    ],
    credentials: true,
  })
);
//    process.env.FRONTEND_URL_STAGING || 'https://staging.example.com',

app.use(express.json()); // To parse JSON request bodies

// --- Import Routes ---
// Auth System Routes
const authRoutes = require("./routes/authRoutes");
const referralRoutes = require("./routes/referralRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const onchainRoutes = require("./routes/onchainRoutes");
const temporaryLedgerRoutes = require("./routes/temporaryLedgerRoutes");
const swiftTransferRoutes = require("./routes/swiftTransferRoutes");
// Renamed from auth-system/depositRoutes to distinguish from xrp system's deposit handling
const hierarchyRoutes = require("./routes/hierarchyRoutes"); // Import hierarchy routes
const userRoutes = require("./routes/userRoutes"); // <-- Import user routes
const promotionRoutes = require("./routes/promotionRoutes");
const supportRoutes = require("./routes/support.js");
const withdrawalRoutes = require("./routes/withdrawalRoutes");
const supportHierarchyRoutes = require("./routes/supportHierarchyRoutes");
const bonusRoutes = require("./routes/bonusRoutes");
const rewardsRoutes = require("./routes/rewardsRoutes");
const reportRoutes = require("./routes/report.js");

// XRP System Routes
// Renamed from xrp/depositRoutes to distinguish
const depositRoutes = require("./routes/depositRoutes");

const {
  startAutoPositioningCron,
} = require("./controllers/ledgerController.js"); // ⬅️ NEW

const depositPoller = require("./jobs/depositPoller"); // Import the new deposit poller
const withdrawalReconciler = require("./jobs/withdrawalReconciler"); // ⬅️ NEW: Import withdrawal reconciler job
const reconcilePendingWithdrawals = require("./jobs/reconcilePendingWithdrawals"); // Pending-withdrawal reconciler

let outboxProcessor; // Declare outboxProcessor
let server;

const PORT = process.env.PORT || 5000;

// Function to start the application (server, outbox, cron)

// awaits the singleton

// Mount Routers (can be done before or after listen, but DB should be ready for requests)
app.get("/", (req, res) => {
  res.send("Unified API Running...");
});
app.use("/api/auth", authRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/deposits", depositRoutes);
app.use("/api/withdrawals", withdrawalRoutes);
app.use("/api/ledger", ledgerRoutes);
app.use("/api/onchain", onchainRoutes);
app.use("/api/temp-ledger", temporaryLedgerRoutes);
app.use("/api/swift-transfers", swiftTransferRoutes);
app.use("/api/hierarchy", hierarchyRoutes); // Mount hierarchy routes
app.use("/api/users", userRoutes); // <-- Use user routes
app.use("/api/promotions", promotionRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/support/hierarchy", supportHierarchyRoutes);
app.use("/api/bonus", bonusRoutes);
app.use("/api/rewards", rewardsRoutes);
app.use("/api/report", reportRoutes);

// Global Error Handler (Place after routes)
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).send("Something broke unexpectedly!");
});

if (process.env.NODE_ENV !== "test") {
  mongoose
    .connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => {
      server = app.listen(PORT, () => {
        console.log(
          `Unified Server running in ${
            process.env.NODE_ENV || "development"
          } mode on port ${PORT}`
        );

        app.locals.db = mongoose.connection.db;
        console.log("MongoDB native db object set to app.locals.db");

     //   depositPoller.start();
      //  startAutoPositioningCron(); // ✅ NEW: Cron for autopositioning
     //   reconcilePendingWithdrawals.start(); // Start new pending-withdrawal reconciler
     //   console.log("Cron jobs scheduled.");

      });
    });
} else {
  console.log("Running in test mode - server listener handled by test suite.");
}


// Graceful Shutdown
const gracefulShutdown = async (signal) => {
  console.log(
    `${signal} signal received: closing HTTP server and Outbox Processor`
  );
  if (server) {
    server.close(async () => {
      console.log("HTTP server closed.");
      await shutdownServices();
    });
  } else {
    await shutdownServices();
  }
};

const shutdownServices = async () => {
  if (outboxProcessor) {
    console.log("Stopping Outbox Processor...");
    outboxProcessor.stop();
    console.log("Outbox Processor stopped.");
  }
  try {
    await mongoose.disconnect();
    console.log("MongoDB connection closed gracefully.");
  } catch (err) {
    console.error("Error during MongoDB disconnection:", err);
  }
  process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("unhandledRejection", (err, promise) => {
  console.error(`Unhandled Rejection at:', promise, 'reason:', err.message`);
  console.error(err.stack);
  gracefulShutdown("UNHANDLED_REJECTION").then(() => process.exit(1));
});

// Start the application

module.exports = app; // Export app for testing purposes
