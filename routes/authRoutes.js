const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose"); // Added for ObjectId validation and transactions
const User = require("..//models/User"); // User model
const { protect, isSupportOrAdmin } = require("../middleware/authMiddleware"); // Import protect middleware
const crypto = require("crypto"); // For generating random password
const sendEmail = require("../utils/sendEmail"); // Import sendEmail utility
const { TIER_REWARDS } = require("../utils/rewardsUtils"); // Import TIER_REWARDS

const {
  signup,
  setPasswordFromLink,
  login,
  forgotPassword,
  resetPassword,
  resetUserPassword,
  resetEmail,
  getMe,
  logout,
  impersonateUser,
  sendEmailVerification,
  walletlogin,

  verifyEmail,
} = require("../controllers/authController");

// Helper function to extract username from email
const getUsernameFromEmail = (email) => {
  return email.split("@")[0].toLowerCase();
};

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post("/signup", signup);

// @route   POST /api/auth/set-password/:token
// @desc    Set user password using a token from email link
// @access  Public
router.post("/set-password/:token", setPasswordFromLink);

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post("/login", login);

// @route   POST /api/auth/walletlogin
// @desc    Authenticate user & get token
// @access  Public
router.post("/walletlogin", walletlogin);



// @route   POST /api/auth/forgot-password
// @desc    Initiate password reset process
// @access  Public
router.post("/forgot-password", forgotPassword);

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password using a token
// @access  Public
router.post("/reset-password/:token", resetPassword);

router.post("/resett-password/:token", resetUserPassword);

// @route   POST /api/auth/reset-email/:token
// @desc    Update email for a user (superadmin token in URL)
// @access  Private (Superadmin or Admin only)
router.post("/reset-email/:token", resetEmail);

// ✅ NEW: Send email verification link
// @route   POST /api/auth/send-email-verification
// @desc    Send verification email to current user's email
// @access  Private
router.post("/send-email-verification", protect, sendEmailVerification);

// ✅ NEW: Verify email with token
// @route   POST /api/auth/verify-email
// @desc    Verify email via token from link
// @access  Public
router.post("/verify-email", verifyEmail);

// @route   GET /api/auth/me
// @desc    Get current logged-in user's data
// @access  Private
router.get("/me", protect, getMe);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post("/logout", protect, logout);

// @route   POST /api/auth/impersonate
// @desc    Support/Admin impersonates another user
// @access  Private (Support/Admin only)
router.post("/impersonate", protect, isSupportOrAdmin, impersonateUser);

module.exports = router;
