const User = require("../models/User");
const Country = require("../models/Country"); // Import the Country model
const sendEmail = require("../utils/sendEmail");
const generateOTP = require("../utils/generateOTP");
const crypto = require("crypto"); // For generating a secure placeholder password & reset tokens
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken"); // For generating JWT token
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose"); // Added for diagnostic
const { processReferral } = require("../services/referralService");
const axios = require("axios");
const { ethers } = require("ethers");

// Define these URLs, possibly from .env or config files
const LOGO_URL =
  process.env.APP_LOGO_URL || "https://example.com/assets/images/logo.png"; // e.g., https://yourdomain.com/assets/logo.png
const LOGIN_URL = process.env.APP_LOGIN_URL || "http://localhost:3001/login"; // e.g., https://yourdomain.com/login
const APP_NAME = process.env.APP_NAME || "USDT Platform";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3001";
const APP_URL = process.env.APP_URL || FRONTEND_URL;
const SUPPORT_EMAIL =
  process.env.APP_SUPPORT_EMAIL || "support@example.com";

const signup = async (req, res) => {
  try {
    // The frontend sends the country 'iso' in the 'country' field.
    const {
      email,
      country,
      whatsappContact,
      sponsorId: sponsorUsername,
    } = req.body;

    const normalizedEmail = email.trim().toLowerCase();
    
    // Check for sponsorId first
    if (!sponsorUsername) {
      return res.status(400).json({
        success: false,
        message: "Sponsor is required. Please use a valid sign-up link.",
      });
    }

    const sponsor = await User.findOne({ username: sponsorUsername });
    if (!sponsor) {
      return res.status(400).json({
        success: false,
        message: "Invalid sponsor specified. Please check the referral link.",
      });
    }

    if (!normalizedEmail) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });
    }

    // The 'country' field from the frontend is the country's ISO code (e.g., 'AL', 'IN')
    if (!country) {
      return res
        .status(400)
        .json({ success: false, message: "Country is required." });
    }

    const countryData = await Country.findOne({ iso: country });
    if (!countryData) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid country selected." });
    }

    const existingUserByEmail = await User.findOne({ email });
    if (existingUserByEmail) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
    let username = baseUsername;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
      const existingUserByUsername = await User.findOne({ username });
      if (!existingUserByUsername) {
        isUnique = true;
      } else {
        const randomSuffix = Math.floor(100 + Math.random() * 900);
        username = `${baseUsername}${randomSuffix}`;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({
        success: false,
        message: "Could not generate a unique username.",
      });
    }

    const registrationToken = crypto.randomBytes(32).toString("hex");
    const registrationTokenExpires = Date.now() + 24 * 3600000; // 24 hours

    const placeholderPassword = crypto.randomBytes(32).toString("hex");
    const uhid = Math.floor(Date.now()).toString();

    const user = new User({
      email: normalizedEmail,
      username,
      uhid,
      password: placeholderPassword,
      country: { name: countryData.name }, // Store the uppercase name 'INDIA'
      countryCode: `+${countryData.phonecode}`, // Store the phone dial code, e.g., '+91'
      whatsappContact: `+${countryData.phonecode}${whatsappContact}`, // Prepend phone code
      registrationToken: crypto
        .createHash("sha256")
        .update(registrationToken)
        .digest("hex"),
      registrationTokenExpires,
      isOtpVerified: false, // We can repurpose this or remove it later
      requiresPasswordChange: true,
    });

    await processReferral(user, sponsorUsername);

    const setPasswordUrl = `${FRONTEND_URL}/auth/set-password/${registrationToken}`;

    try {
      const emailTemplatePath = path.join(
        __dirname,
        "../email-templates/welcomeEmail.html"
      );
      let htmlContent = fs.readFileSync(emailTemplatePath, "utf8");

      htmlContent = htmlContent
        .replace(/{{logoUrl}}/g, LOGO_URL)
        .replace(/{{username}}/g, username)
        .replace(/{{setPasswordUrl}}/g, setPasswordUrl)
        .replace(/{{appName}}/g, APP_NAME)
        .replace(/{{supportEmail}}/g, SUPPORT_EMAIL)
        .replace(/{{appUrl}}/g, APP_URL)
        .replace(/{{currentYear}}/g, new Date().getFullYear().toString());

      const textContent = `Welcome to ${APP_NAME}! Please set your password by clicking this link: ${setPasswordUrl}`;

      await sendEmail(
        user.email,
        `Welcome to ${APP_NAME} - Set Your Password`,
        textContent,
        htmlContent
      );
    } catch (emailError) {
      console.error(
        `Failed to send welcome email to ${user.email}:`,
        emailError
      );
      return res.status(500).json({
        success: false,
        message: "Account created, but we failed to send the activation email. Please contact support to activate your account.",
      });
    }

    res.status(201).json({
      success: true,
      message:
        "User created successfully. Please check your email to set your password.",
    });
  } catch (error) {
    console.error("Signup error:", error);
    if (error.code === 11000) {
      let duplicateField = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        message: `An account with this ${duplicateField} already exists.`,
      });
    }
    res.status(500).json({
      success: false,
      message: "Error creating user. Please try again later.",
    });
  }
};

const setPasswordFromLink = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match." });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      registrationToken: hashedToken,
      registrationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Registration token is invalid or has expired.",
      });
    }
    if (!user.requiresPasswordChange) {
      return res.status(400).json({
        success: false,
        message: "Password has already been set for this account.",
      });
    }

    user.password = password;
    user.requiresPasswordChange = false;
    user.isOtpVerified = true; // Mark as verified
    user.registrationToken = undefined;
    user.registrationTokenExpires = undefined;

    await user.save();

    const jwtPayload = { user: { id: user._id } };
    const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || "2h",
    });

    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
    };

    res.status(200).json({
      success: true,
      message: "Password has been set successfully. You are now logged in.",
      token: jwtToken,
      user: userToReturn,
    });
  } catch (error) {
    console.error("Set Password from Link error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during password setup." });
  }
};

const login = async (req, res) => {
  const { email, username, password } = req.body;

  // Maintenance mode check — allow only Mrperfect2025@icloud.com
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === "true";
  const allowedDuringMaintenance = "Mrperfect2025@icloud.com";

  if (isMaintenanceMode && email !== allowedDuringMaintenance) {
    return res.status(503).json({
      success: false,
      message:
        "Our system is currently undergoing scheduled maintenance to serve you better. We appreciate your patience and will be back online shortly.",
    });
  }

  // Require credentials
  if ((!email && !username) || !password) {
    return res.status(400).json({
      success: false,
      message: "Please provide (email/username/UHID) and password",
    });
  }

  try {
    // Determine login type
    let query = {};

    // Prefer "email" input but handle dynamic type detection
    if (email) {
      const trimmedInput = email.trim();

      // Check if it's a number → UHID
      if (!isNaN(trimmedInput)) {
        query = { uhid: Number(trimmedInput) };
      }
      // Check if it looks like an email
      else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedInput)) {
        query = { email: trimmedInput };
      }
      // Otherwise treat as username
      else {
        query = { username: trimmedInput };
      }
    } else if (username) {
      query = { username: username };
    }

    const user = await User.findOne(query).select("+password");

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials." });
    }

    // --- Password setup flow ---
    if (user.requiresPasswordChange) {
      const registrationToken = crypto.randomBytes(32).toString("hex");
      user.registrationToken = crypto
        .createHash("sha256")
        .update(registrationToken)
        .digest("hex");
      user.registrationTokenExpires = Date.now() + 24 * 3600000;
      await user.save();

      const setPasswordUrl = `${FRONTEND_URL}/auth/set-password/${registrationToken}`;
      try {
        const emailTemplatePath = path.join(
          __dirname,
          "../email-templates/welcomeEmail.html"
        );
        let htmlContent = fs.readFileSync(emailTemplatePath, "utf8");
        htmlContent = htmlContent
          .replace(/{{username}}/g, user.username)
          .replace(/{{setPasswordUrl}}/g, setPasswordUrl)
          .replace(/{{appName}}/g, APP_NAME)
          .replace(/{{logoUrl}}/g, LOGO_URL)
          .replace(/{{supportEmail}}/g, SUPPORT_EMAIL)
          .replace(/{{appUrl}}/g, APP_URL)
          .replace(/{{currentYear}}/g, new Date().getFullYear().toString());

        const textContent = `Welcome to ${APP_NAME}! Please set your password by clicking this link: ${setPasswordUrl}`;
        await sendEmail(
          user.email,
          `Set Your Password for ${APP_NAME}`,
          textContent,
          htmlContent
        );

        return res.status(401).json({
          success: false,
          actionRequired: "ACTIVATE_ACCOUNT",
          message:
            "Your account is not yet active. We have sent a new password setup link to your email.",
        });
      } catch (emailError) {
        console.error(
          `Failed to re-send welcome email to ${user.email}:`,
          emailError
        );
        return res.status(500).json({
          success: false,
          message: "Error sending activation email. Please try again later.",
        });
      }
    }

    // --- Password check ---
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials." });
    }

    // --- JWT payload ---
    const payload = {
      user: {
        id: user._id,
        tokenVersion: user.tokenVersion || 0,
      },
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || "2h",
    });

    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
      uhid: user.uhid,
      country: user.country,
      countryCode: user.countryCode,
      whatsappContact: user.whatsappContact,
      isOtpVerified: user.isOtpVerified,
      requiresPasswordChange: user.requiresPasswordChange,
      counters: user.counters,
      balanceUSDT: user.balanceUSDT,
      usdtBalance: user.usdtBalance,
      wallet_address: user.wallet_address,
      createdAt: user.createdAt,
    };

    res.json({ success: true, token, user: userToReturn });
  } catch (err) {
    console.error("Login Error in controller:", err.message);
    res.status(500).send("Server error during login");
  }
};
const walletlogin = async (req, res) => {
  try {
    const { wallet_address, signature, message } = req.body;

    if (!wallet_address || !signature || !message) {
      return res.status(400).json({
        success: false,
        message: "wallet_address, signature, and message are required",
      });
    }

    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== wallet_address.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: "Signature verification failed",
      });
    }

    const user = await User.findOne({ wallet_address });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found for this wallet address",
      });
    }

    // ----------------------------------------------------
    // 3️⃣ Create JWT
    // ----------------------------------------------------
    const payload = {
      user: {
        id: user._id,
        tokenVersion: user.tokenVersion || 0,
      },
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || "2h",
    });

    // ----------------------------------------------------
    // 4️⃣ Return same user format as your old login
    // ----------------------------------------------------
    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
      uhid: user.uhid,
      country: user.country,
      countryCode: user.countryCode,
      whatsappContact: user.whatsappContact,
      isOtpVerified: user.isOtpVerified,
      requiresPasswordChange: user.requiresPasswordChange,
      counters: user.counters,
      balanceUSDT: user.balanceUSDT,
      usdtBalance: user.usdtBalance,
      wallet_address: user.wallet_address,
      createdAt: user.createdAt,
    };

    return res.json({
      success: true,
      token,
      user: userToReturn,
      loginType: "WALLET_SIGNATURE"
    });

  } catch (err) {
    console.error("🔥 Wallet login error:", err);
    res.status(500).json({
      success: false,
      message: "Server error during wallet login",
    });
  }
};


const logout = async (req, res) => {
  // In a stateless JWT setup, logout is typically handled on the client-side
  // by clearing the token. However, a server-side endpoint can be useful for
  // things like token blocklisting if you implement such a feature.
  // For now, we'll just send a success response.
  res.status(200).json({ success: true, message: "Logged out successfully." });
};

const getMe = async (req, res) => {
  // req.user should be populated by the 'protect' middleware
  try {
    // The user ID is extracted from the token by the `protect` middleware
    // and attached to the request object as `req.user`.
    const user = await User.findById(req.user._id).select("-password"); // Exclude password from the result

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // Return all non-sensitive user data
    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("GetMe error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching user data.",
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

    await user.save();

    const resetUrl = `${FRONTEND_URL}/reset-password/${resetToken}`;

    try {
      // This needs an email template that uses a URL, not an OTP.
      // Assuming a template like 'passwordResetEmail.html' exists.
      const emailTemplatePath = path.join(
        __dirname,
        "../email-templates/passwordResetEmail.html"
      );
      let htmlContent = fs.readFileSync(emailTemplatePath, "utf8");
      htmlContent = htmlContent
        .replace(/{{logoUrl}}/g, LOGO_URL)
        .replace(/{{appName}}/g, APP_NAME)
        .replace(/{{supportEmail}}/g, SUPPORT_EMAIL)
        .replace(/{{appUrl}}/g, APP_URL)
        .replace(/{{username}}/g, user.username)
        .replace(/{{resetUrl}}/g, resetUrl) // Use resetUrl instead of otp
        .replace(/{{currentYear}}/g, new Date().getFullYear().toString());

      const textContent = `You are receiving this email because you (or someone else) have requested the reset of a password. Please click on the following link, or paste this into your browser to complete the process: ${resetUrl}`;

      await sendEmail(
        user.email,
        `Password Reset Request for ${APP_NAME}`,
        textContent,
        htmlContent
      );
      res.status(200).json({
        success: true,
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    } catch (emailError) {
      console.error(
        `Failed to send password reset email to ${user.email}:`,
        emailError
      );
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();
      return res.status(500).json({
        success: false,
        message: "Error sending password reset email. Please try again.",
      });
    }
  } catch (error) {
    console.error("Forgot Password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during password reset process.",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { currentPassword, newPassword, confirmPassword, id } = req.body;

    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    let user;

    if (id) {
      // Superadmin flow
      user = await User.findById(id).select("+password");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      // ✅ Validate current password
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password is required.",
        });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect.",
        });
      }
    } else {
      // Token-based reset flow
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
      }).select("+password");

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Password reset token is invalid or has expired.",
        });
      }

      // In token-based flow, current password is NOT required
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
    }

    user.password = newPassword;
    user.requiresPasswordChange = false;
    user.isOtpVerified = true;

    await user.save();

    const payload = {
      user: {
        id: user._id,
        tokenVersion: user.tokenVersion || 0,
      },
    };

    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || "2h",
    });

    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
      wallet_address: user.wallet_address,
    };

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You are now logged in.",
      token: jwtToken,
      user: userToReturn,
    });
  } catch (error) {
    console.error("Reset Password error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during password reset." });
  }
};
// Helper to generate raw + hashed token
const makeToken = () => {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
};

const sendTransactionSuccessEmail = async (userId, txData) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      console.warn("⚠️ User not found for transaction email:", userId);
      return;
    }

    const { amountUSDT, txHash, txDate } = txData;
    const subject = "Transaction Successful";

    const formattedDateUTC = new Date(txDate).toUTCString();

    const textBody = [
      `Hi ${user.username || "there"},`,
      `Your USDT transaction has been successfully processed.`,
      ``,
      `Amount: ${amountUSDT} USDT`,
      `Transaction Hash: ${txHash}`,
      `Date (UTC): ${formattedDateUTC}`,
      ``,
      `You can view it on the BSC Explorer:`,
      `https://bscscan.com/tx/${txHash}`,
      ``,
      `Thank you for using our service!`,
    ].join("\n");

    const htmlBody = `
      <div style="background:#0d1117;color:#e6edf3;font-family:'Segoe UI',Roboto,Arial,sans-serif;
                  max-width:600px;margin:auto;padding:24px;border-radius:12px;">
        <div style="background:#161b22;padding:24px;border-radius:12px;box-shadow:0 0 10px rgba(0,0,0,0.4);">
          <h2 style="color:#4cc9f0;text-align:center;margin-bottom:16px;">✅ Transaction Successful</h2>
          <p style="font-size:15px;line-height:1.6;">Hi ${user.username || "there"},</p>
          <p style="font-size:15px;line-height:1.6;">
            Your <strong>USDT</strong> transaction has been successfully completed on BSC.
          </p>
          
          <table style="width:100%;margin-top:20px;border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#8b949e;">Amount:</td>
              <td style="padding:8px 0;color:#fff;font-weight:600;">${amountUSDT} USDT</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#8b949e;">Date (UTC):</td>
              <td style="padding:8px 0;color:#fff;">${formattedDateUTC}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#8b949e;">Transaction Hash:</td>
              <td style="padding:8px 0;word-break:break-all;color:#9be9a8;">${txHash}</td>
            </tr>
          </table>

          <div style="text-align:center;margin-top:24px;">
            <a href="https://bscscan.com/tx/${txHash}"
               style="display:inline-block;background:linear-gradient(90deg,#4cc9f0,#4361ee);
                      color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;
                      font-weight:600;box-shadow:0 0 8px rgba(76,201,240,0.4);">
              🔍 View on BSC Explorer
            </a>
          </div>

          <p style="color:#8b949e;font-size:13px;margin-top:24px;text-align:center;">
            Thank you for using our platform!<br>
            Stay secure and keep trading with confidence 🚀
          </p>
        </div>
      </div>
    `;

    await sendEmail(user.email, subject, textBody, htmlBody);
    
  } catch (err) {
    console.error("❌ Error sending transaction success email:", err);
  }
};


// @desc    Send email verification link
// @route   POST /api/auth/send-email-verification
// @access  Private

const sendEmailVerification = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.isEmailVerified) {
      return res.json({ success: true, message: "Email already verified." });
    }

    // Generate token, store hash + expiry
    const { raw, hash } = makeToken();
    user.emailVerificationToken = hash;
    user.emailVerificationExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await user.save();

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${raw}`;

    // Debug log for development/testing
    

    const subject = "Verify your email";
    const textBody = [
      `Hi ${user.username || "there"},`,
      `Please verify your email by opening this link:`,
      verifyUrl,
      `This link expires in 30 minutes.`,
    ].join("\n\n");

    const htmlBody = `
      <p>Hi ${user.username || "there"},</p>
      <p>Please verify your email by clicking the button below:</p>
      <p>
        <a href="${verifyUrl}" style="padding:10px 16px;background:#4f8cff;color:#fff;border-radius:6px;text-decoration:none;">
          Verify Email
        </a>
      </p>
      <p>Or open this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color:#777">This link expires in 30 minutes.</p>
    `;

    await sendEmail(user.email, subject, textBody, htmlBody);

    // 🔥 Add dev-only payload so the frontend can show the token in a popup and auto-verify
    const payload = { success: true, message: "Verification email sent." };
    if (process.env.NODE_ENV !== "production" || req.query.debug === "1") {
      payload.devToken = raw;
      payload.devVerifyUrl = verifyUrl;
    }

    return res.json(payload);
  } catch (err) {
    console.error("sendEmailVerification error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Could not send verification email." });
  }
};

// @desc    Verify email using token
// @route   POST /api/auth/verify-email
// @access  Public
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: "Missing token." });
    }

    const hash = crypto.createHash("sha256").update(token).digest("hex");

    // Atomically verify user if token matches and not expired
    const now = new Date();
    const updated = await User.findOneAndUpdate(
      {
        emailVerificationToken: hash,
        emailVerificationExpires: { $gt: now },
      },
      {
        $set: { isEmailVerified: true },
        $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired token." });
    }

    // Optional debug
    

    return res.json({
      success: true,
      message: "Email verified successfully.",
      user: {
        _id: updated._id,
        username: updated.username,
        email: updated.email,
        isEmailVerified: updated.isEmailVerified,
      },
    });
  } catch (err) {
    console.error("verifyEmail error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Verification failed." });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword, confirmPassword, id } = req.body;

    if (newPassword !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    let user;

    if (id) {
      // Superadmin: find user by ID
      user = await User.findById(id).select("+password");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }
    } else {
      // Token-based flow
      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

      user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
      }).select("+password");

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Password reset token is invalid or has expired.",
        });
      }

      // Clear token fields
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
    }

    // Update password and flags
    user.password = newPassword;
    user.requiresPasswordChange = false;
    user.isOtpVerified = true;

    // Mark password as modified if needed
    user.markModified("password");

    // Save user
    await user.save();

    // JWT creation
    const payload = {
      user: {
        id: user._id,
        tokenVersion: user.tokenVersion || 0,
      },
    };

    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || "2h",
    });

    const userToReturn = {
      _id: user._id,
      username: user.username,
      email: user.email,
      wallet_address: user.wallet_address,
    };

    res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You are now logged in.",
      token: jwtToken,
      user: userToReturn,
    });
  } catch (error) {
    console.error("Reset Password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during password reset.",
    });
  }
};
const resetEmail = async (req, res) => {
  try {
    const { id, newEmail } = req.body;
    const token = req.params.token;

    // Basic validation
    if (!id || !newEmail) {
      return res.status(400).json({
        success: false,
        message: "User ID and new email are required.",
      });
    }

    // Optional: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email format." });
    }

    // Find user by ID
    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // Check if email already exists
    const existing = await User.findOne({ email: newEmail });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "Email already in use." });
    }

    // Update and save
    user.email = newEmail;
    await user.save();

    res
      .status(200)
      .json({ success: true, message: "Email updated successfully." });
  } catch (error) {
    console.error("Reset Email error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during email update." });
  }
};

const sendTestEmail = async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({
      success: false,
      message: "Please provide a recipient email address.",
    });
  }
  try {
    await sendEmail(
      to,
      "Test Email",
      "This is a test email from the application."
    );
    res
      .status(200)
      .json({ success: true, message: `Test email sent to ${to}` });
  } catch (error) {
    console.error("Send test email error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to send test email." });
  }
};
const impersonateUser = async (req, res) => {
  try {
    const requestingUser = req.user; // Authenticated user from middleware
    const { targetUserId } = req.body;

    console.log(
      `🕵️ Impersonation attempt by ${requestingUser.username} (${requestingUser.userType})`
    );

    // 🔐 Only allow admin, superadmin, or support to impersonate
    if (!["admin", "superadmin", "support"].includes(requestingUser.userType)) {
      console.warn("❌ Unauthorized impersonation attempt: Invalid role");
      return res.status(403).json({
        success: false,
        message:
          "Access denied: Only admin, superadmin, or support can impersonate users.",
      });
    }

    // 🚫 Restrict impersonation to specific email
    if (requestingUser.email !== "Mrperfect2025@icloud.com") {
      console.warn("❌ Unauthorized impersonation attempt: Invalid email");
      return res.status(403).json({
        success: false,
        message:
          "Access denied: Only Mrperfect2025@icloud.com is allowed to impersonate users.",
      });
    }

    // Find the target user to impersonate
    const targetUser = await User.findById(targetUserId).select("-password");

    if (!targetUser) {
      console.warn("❌ Target user not found");
      return res.status(404).json({
        success: false,
        message: "Target user not found.",
      });
    }

    // ✅ Sign JWT for impersonated user and include impersonatorUserType
    const token = jwt.sign(
      {
        user: {
          id: targetUser._id,
          userType: targetUser.userType,
          tokenVersion: targetUser.tokenVersion,
          impersonatorUserType: requestingUser.userType, // ✅ NEW: track original
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    console.log(
      `✅ Impersonation successful: ${targetUser.username} by ${requestingUser.username}`
    );

    return res.status(200).json({
      success: true,
      token,
      impersonatedUser: targetUser,
    });
  } catch (error) {
    console.error("❌ Server error during impersonation:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during impersonation.",
    });
  }
};

module.exports = {
  signup,
  setPasswordFromLink,
  login,
  walletlogin,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  resetUserPassword,
  resetEmail,
  sendTestEmail,
  verifyEmail,
  sendEmailVerification,
  sendTransactionSuccessEmail,
  impersonateUser,
};
