require("dotenv").config(); // Ensure .env is loaded first
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
// const mongoSanitize = require("express-mongo-sanitize"); // Removed due to Express 5 incompatibility
// const xss = require("xss-clean"); // Removed due to incompatibility

// --- Database Connection ---
// Assuming db.js is in project-merged/config/db.js and handles the connection
// If xrp system had a direct mongoose.connect, that logic is now centralized in db.js
const connectDB = require("./config/db");
const app = express();
app.set("trust proxy", true);

// --- Middleware ---
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      try {
        const { hostname } = new URL(origin);

        // Allow localhost on any port
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          return callback(null, true);
        }

        // Allow any private/local network IP
        if (
          /^192\.168\./.test(hostname) ||
          /^10\./.test(hostname) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
        ) {
          return callback(null, true);
        }

        // --- PRODUCTION IP SUPPORT ---
        // Allow your specific production IP (172.86.113.73)
        if (hostname === "172.86.113.73") {
          return callback(null, true);
        }

        // Allow production domain or IP from env
        const prodUrl = process.env.FRONTEND_URL || "";
        if (prodUrl) {
          const prodHostname = new URL(prodUrl).hostname;
          if (hostname === prodHostname) {
            return callback(null, true);
          }
        }

        // Known production IPs/domains
        const allowedOrigins = [
          "http://168.144.33.10",
          "http://168.144.33.10:3007",
          "http://168.144.33.10/mlm-api",
          "http://192.168.1.4:3000",
          "http://192.168.1.4:5000"
        ];
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Block everything else
        return callback(new Error(`CORS: Origin ${origin} not allowed`));
      } catch {
        return callback(new Error("CORS: Invalid origin"));
      }
    },
    credentials: true,
  })
);
//    process.env.FRONTEND_URL_STAGING || 'https://staging.example.com',

app.use(express.json({ limit: '10kb' })); // Body parser, limit data size

// --- Advanced Security Middleware ---
// 1. Set Security HTTP headers with specific Referrer Policy for CORS compatibility
app.use(
  helmet({
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// 2. Custom NoSQL Sanitization (Express 5 Compatible)
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj && typeof obj === "object") {
      Object.keys(obj).forEach((key) => {
        if (key.startsWith("$") || key.includes(".")) {
          delete obj[key];
        } else if (obj[key] && typeof obj[key] === "object") {
          sanitize(obj[key]);
        }
      });
    }
  };

  // We clone to avoid read-only property errors in Express 5
  if (req.query) {
    const cleanQuery = { ...req.query };
    sanitize(cleanQuery);
    Object.defineProperty(req, 'query', { value: cleanQuery, writable: true });
  }
  if (req.params) {
    const cleanParams = { ...req.params };
    sanitize(cleanParams);
    Object.defineProperty(req, 'params', { value: cleanParams, writable: true });
  }
  if (req.body) {
    sanitize(req.body);
  }
  next();
});

// 3. Data Sanitization against XSS (Handled by custom sanitizers and React)
// app.use(xss()); // Removed

// 4. Prevent Parameter Pollution
app.use(hpp());

// 5. Rate Limiting
const globalLimiter = rateLimit({
  max: 1000,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests from this IP, please try again in an hour!',
  validate: { trustProxy: false } // Fix for ERR_ERL_PERMISSIVE_TRUST_PROXY
});
// app.use('/api', globalLimiter);

const authLimiter = rateLimit({
  max: 20, // Limit to 20 attempts per 10 minutes
  windowMs: 10 * 60 * 1000,
  message: 'Too many authentication attempts, please try again in 10 minutes!',
  validate: { trustProxy: false } // Fix for ERR_ERL_PERMISSIVE_TRUST_PROXY
});
// app.use('/api/auth', authLimiter);

// --- Import Routes ---
// Auth System Routes
const authRoutes = require("./routes/authRoutes");
const referralRoutes = require("./routes/referralRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const onchainRoutes = require("./routes/onchainRoutes");
const temporaryLedgerRoutes = require("./routes/temporaryLedgerRoutes");
const swiftTransferRoutes = require("./routes/swiftTransferRoutes");
const phantomDepositRoutes = require("./routes/phantomDepositRoutes");
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
const configRoutes = require("./routes/configRoutes");
const adminProtocolRoutes = require("./routes/adminProtocolRoutes");
const referralRewardsRoutes = require("./routes/referralRewardsRoutes");

// XRP System Routes
// Renamed from xrp/depositRoutes to distinguish
const depositRoutes = require("./routes/depositRoutes");

const {
  startAutoPositioningCron,
} = require("./controllers/ledgerController.js"); // ⬅️ NEW

const depositPoller = require("./jobs/depositPoller"); // Import the new deposit poller
const bep20Watcher = require("./jobs/bep20Watcher");
const withdrawalReconciler = require("./jobs/withdrawalReconciler"); // ⬅️ NEW: Import withdrawal reconciler job
const reconcilePendingWithdrawals = require("./jobs/reconcilePendingWithdrawals"); // Pending-withdrawal reconciler
const OutboxProcessor = require("./jobs/OutboxProcessor");
const {
  scheduleDailyRoiBatchJob,
  enqueueMissedDailyRoiBatchIfNeeded,
} = require("./jobs/cronJobs");
const {
  handleDailyRoiBatch,
  handleDailyRoiUser,
  handleRoiCascade,
} = require("./jobs/eventHandlers");

let outboxProcessor; // Declare outboxProcessor
let server;
let dailyRoiCronTask;

const PORT = process.env.PORT || 5000;

// Function to start the application (server, outbox, cron)

// awaits the singleton

// Mount Routers (can be done before or after listen, but DB should be ready for requests)
app.get("/", (req, res) => {
  res.send("Unified API Running...");
});
app.use("/api/auth", authRoutes);
app.use("/api/phantom-deposits", phantomDepositRoutes);
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
app.use("/api/config", configRoutes);
app.use("/api/admin/protocol", adminProtocolRoutes);
app.use("/api/referral-rewards", referralRewardsRoutes);

// Global Error Handler (Place after routes)
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).send("Something broke unexpectedly!");
});

if (process.env.NODE_ENV !== "test") {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
      server = app.listen(PORT, () => {
        console.log(
          `Unified Server running in ${process.env.NODE_ENV || "development"
          } mode on port ${PORT}`
        );

        app.locals.db = mongoose.connection.db;

        // Auto-seed countries if collection is empty (failsafe for production)
        const Country = require("./models/Country");
        Country.countDocuments()
          .then(async (count) => {
            if (count === 0) {
              console.log("[Boot] Countries collection is empty. Auto-seeding countries...");
              const { seedCountries } = require("./utils/seedCountriesHelper");
              await seedCountries();
            } else {
              console.log(`[Boot] Found ${count} countries in database. No seeding required.`);
            }
          })
          .catch((err) => {
            console.error("[Boot] Country check/seeding error:", err);
          });

        const bscWatcher = require("./services/BscWatcherService");
        bscWatcher.start().catch(err => console.error("Failed to start BSC Watcher:", err));

        depositPoller.start();

        outboxProcessor = new OutboxProcessor();
        outboxProcessor.registerHandler("DAILY_ROI_BATCH", handleDailyRoiBatch);
        outboxProcessor.registerHandler("DAILY_ROI_USER", handleDailyRoiUser);
        outboxProcessor.registerHandler("ROI_CASCADE", handleRoiCascade);
        outboxProcessor.start();

        dailyRoiCronTask = scheduleDailyRoiBatchJob();
        enqueueMissedDailyRoiBatchIfNeeded().catch((err) =>
          console.error("Failed to enqueue missed DAILY_ROI_BATCH:", err)
        );

        // Automatically start the Master Cron Jobs Runner
        require("./CroneJobs");
      });
    });
} else {

}


// Graceful Shutdown
const gracefulShutdown = async (signal) => {
  console.log(
    `${signal} signal received: closing HTTP server and Outbox Processor`
  );
  if (server) {
    server.close(async () => {

      await shutdownServices();
    });
  } else {
    await shutdownServices();
  }
};

const shutdownServices = async () => {
  if (outboxProcessor) {

    outboxProcessor.stop();

  }
  if (dailyRoiCronTask) {
    dailyRoiCronTask.stop();
    dailyRoiCronTask = null;
  }
  try {
    await mongoose.disconnect();

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
