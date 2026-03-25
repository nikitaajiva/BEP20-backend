const jwt = require('jsonwebtoken');
const User = require('../models/User');
const mongoose = require('mongoose');
const getClientIP = (req) => {
  let ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress;

  if (ip === "::1" || ip === "127.0.0.1") {
    ip = "127.0.0.1"; // Localhost
  }

  return ip;
};
// Middleware to verify token and protect routes
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.user.id).select('-password');

      if (!user) {
        return res.status(401).json({ msg: 'Not authorized, user not found' });
      }
      const userIp = getClientIP(req);
      console.log("User IP:", userIp);

      // ✅ Check if tokenVersion matches (for logout after maintenance activation)
      if (user.tokenVersion !== decoded.user.tokenVersion) {
        return res.status(401).json({
          msg: 'Session expired due to maintenance or security update. Please log in again.',
        });
      }

      // ✅ Check maintenance mode
      const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';
      const allowedDuringMaintenance = 'Mrperfect2025@icloud.com';
      if (isMaintenanceMode && user.email !== allowedDuringMaintenance) {
        return res.status(503).json({
          success: false,
          message:
            'System is under maintenance. Please try again later.',
        });
      }
      req.userip = userIp;
      req.user = user;
      next();
    } catch (error) {
      console.error('Token verification error:', error.message);
      return res.status(401).json({ msg: 'Not authorized, token failed' });
    }
  } else {
    return res.status(401).json({ msg: 'Not authorized, no token' });
  }
};


const isInBlockedWindow = () => {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();

  const totalMinutes = hours * 60 + minutes;

  const blockStart = 23 * 60 + 34;  // 23:34 UTC = 1414 minutes
  //const blockEnd = 0 * 60 + 55;     // 00:25 UTC (next day) = 25 minutes
  const blockEnd   = 1 * 60 + 30; 

  // If time is between 23:34 and 23:59, or between 00:00 and 00:25
  return totalMinutes >= blockStart || totalMinutes < blockEnd;
};

const blockDuringCron = (req, res, next) => {
  if (isInBlockedWindow()) {
    console.warn(`[BLOCKED] ${req.originalUrl} at ${new Date().toISOString()} (UTC)`);
    return res.status(503).json({
      success: false,
      message: "Temporarily unavailable due to maintenance. Please try again after 01:30 UTC.",
    });
  }
  next();
};

const allowedDuringMaintenance = 'Mrperfect2025@icloud.com';
const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';

// const protect = async (req, res, next) => {
//   let token;

//   if (
//     req.headers.authorization &&
//     req.headers.authorization.startsWith('Bearer')
//   ) {
//     try {
//       // Get token from header
//       token = req.headers.authorization.split(' ')[1];

//       // Verify token
//       const decoded = jwt.verify(token, process.env.JWT_SECRET);

//       console.log(`[authMiddleware.js protect] Mongoose Connection ID: ${mongoose.connection.id}`);

//       // Get user from the token
//       req.user = await User.findById(decoded.user.id).select('-password');

//       if (!req.user) {
//         return res.status(401).json({ msg: 'Not authorized, user not found' });
//       }

//       // 🔒 Maintenance mode check
//       if (isMaintenanceMode && req.user.email !== allowedDuringMaintenance) {
//         return res.status(503).json({
//           success: false,
//           message:
//             "🚧 We're currently performing scheduled maintenance to enhance your experience. Please check back shortly — we’ll be back soon, better than ever!",
//         });
//       }

//       next();
//     } catch (error) {
//       console.error('Token verification error:', error.message);
//       return res.status(401).json({ msg: 'Not authorized, token failed' });
//     }
//   } else {
//     return res.status(401).json({ msg: 'Not authorized, no token' });
//   }
// };
// Middleware to check if user is support or admin
// const isSupportOrAdmin = (req, res, next) => {
//   if (req.user && (req.user.userType === 'support' || req.user.userType === 'admin')) {
//     next();
//   } else {
//     res.status(403).json({ msg: 'Forbidden: Access is restricted to support or admin users.' });
//   }
// };


// ✅ Updated to support impersonation roles
const isSupportOrAdmin = (req, res, next) => {
  const userRole = req.user.impersonatorUserType || req.user.userType;

  if (["support", "admin"].includes(userRole)) {
    return next();
  }

  return res.status(403).json({
    msg: "Forbidden: Access is restricted to support or admin users.",
  });
};

module.exports = { protect, isSupportOrAdmin,blockDuringCron };
