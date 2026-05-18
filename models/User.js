// const mongoose = require("mongoose");
// const bcrypt = require("bcryptjs");

// const UserSchema = new mongoose.Schema({
//   // Fields from original User.js / Auth-System
//   email: {
//     type: String,
//     required: [true, "Please provide an email"],
//     unique: true,
//     match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/, "Please provide a valid email"],
//   },
//   username: {
//     type: String,
//     required: [true, "Please provide a username."],
//     unique: true,
//     trim: true,
//     minlength: [3, "Username must be at least 3 characters long"],
//   },
//   uhid: {
//     type: String,
//     required: [true, "Please provide a uhid."],
//     unique: true,
//     trim: true,
//   },
//   password: {
//     type: String,
//     required: [true, "Please provide a password."],
//     minlength: [6, "Password must be at least 6 characters long"],
//     select: false,
//   },
//   // Fields from existing user document for backward compatibility
//   id: String, // Legacy ID from old system
//   timestamp: String, // Legacy timestamp, new documents will use registrationTs

//   joiningTimeStamp: {
//     type: Date,
//     default: Date.now,
//   },

//   country: {},
//   countryCode: String,
//   whatsappContact: { type: String, trim: true },

//   // Verification and OTP related fields (from Auth-System, also present in USDT)
//   isVerified: { type: Boolean, default: false }, // General verification status
//   otp: String,
//   otpExpiry: Date,
//   isOtpVerified: { type: Boolean, default: false }, // Specific to email/phone OTP verification
//   requiresPasswordChange: { type: Boolean, default: false }, // For initial password setup

//   autopositioning: {
//     type: Boolean,
//     default: false,
//   },

//   // Fields for the two-step initial password setting flow
//   pendingPassword: { type: String, select: false },
//   passwordChangeOtp: { type: String, select: false },
//   passwordChangeOtpExpiry: { type: Date, select: false },
//   tokenVersion: { type: Number, default: 1 },
//   registrationToken: String,
//   registrationTokenExpires: Date,

//   resetPasswordToken: String, // For password reset functionality
//   resetPasswordExpires: Date, // Expiry for password reset token

//   googleId: String, // For Google Sign-In users

//   // Sponsor, Path, Level, Height (present in both, using USDT structure where applicable)
//   sponsorId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     default: null,
//   },
//   path: {
//     // Hierarchy path (root -> parent -> self)
//     type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
//     default: [],
//   },
//   level: {
//     // User's level in the hierarchy/network
//     type: Number,
//     default: 0,
//     min: 0,
//   },
//   height: {
//     // Max depth of the subtree rooted at this user
//     type: Number,
//     default: 0,
//     min: 0,
//   },

//   // Fields specific to USDT model structure
//   registrationTs: {
//     type: Date,
//     default: Date.now,
//   },
//   levelsOpen: {
//     type: Number,
//     default: 0,
//     min: 0,
//   },

//   // Counters (from USDT model, includes directReferrals which replaces directDownlines)
//   counters: {
//     selfLp: {
//       // LP deposited by the user themselves
//       type: mongoose.Schema.Types.Decimal128,
//       default: "0.0",
//     },
//     teamLpFirst3Lvls: {
//       // Total LP from team members in the first 3 levels
//       type: mongoose.Schema.Types.Decimal128,
//       default: "0.0",
//     },
//     teamLpFirst5Lvls: {
//       // Total LP from team members in the first 5 levels
//       type: mongoose.Schema.Types.Decimal128,
//       default: "0.0",
//     },
//     teamLpFirst16Lvls: {
//       // Total LP from team members in the first 16 levels
//       type: mongoose.Schema.Types.Decimal128,
//       default: "0.0",
//     },
//     totalTeamLp: {
//       // Total LP from all team members in the downline
//       type: mongoose.Schema.Types.Decimal128,
//       default: "0.0",
//     },
//   },

//   // Balance fields from Auth-System (crucial for deposit controller)
//   balanceUSDT: {
//     // General USDT balance, possibly for other uses or legacy
//     type: Number,
//     default: 0,
//     min: 0,
//   },
//   usdtBalance: {
//     // Balance derived from Usdt deposits (managed by deposit controller)
//     type: Number,
//     default: 0,
//     min: 0,
//   },
//   firstLpDepositTs: {
//     type: Date,
//     default: null,
//   },

//   wallet_address: {
//     // New field for user's USDT address
//     type: String,
//     trim: true,
//     default: null, // Or an empty string, depending on preference
//   },

//   notificationSettings: {
//     successfulDeposits: { type: Boolean, default: true },
//     withdrawalConfirmations: { type: Boolean, default: true },
//   },

//   createdAt: {
//     type: Date,
//     default: Date.now,
//   },
//   walletAddress: {
//     type: String,
//     trim: true,
//   },
//   communitySize: {
//     // Total number of users in this user's downline (added from Auth system concept)
//     type: Number,
//     default: 0,
//     min: 0,
//   },
//   directDownlines: {
//     // Number of users directly sponsored by this user
//     type: Number,
//     default: 0,
//     min: 0,
//   },
//   positioningRank: {
//     type: String,
//     enum: [null, "X1", "X2", "X3", "X4", "X5"],
//     default: null,
//   },
//   xRank: {
//     type: String,
//     enum: [null, "X1", "X2", "X3", "X4", "X5"],
//     default: null,
//     index: true,
//   },
//   xRankLastUpdated: {
//     type: Date,
//     default: null,
//   },
//   paidRankBonuses: {
//     type: [{ type: String }],
//     default: [],
//   },
//   userType: {
//     type: String,
//     enum: ["user", "support", "admin"],
//     default: "user",
//   },
//   totalReferrals: {
//     type: Number,
//     default: 0,
//   },
//   // Note: Wallets and Limits might be handled by a separate Ledger document as per USDT model's original comment.
// });

// // Pre-save middleware to hash password
// UserSchema.pre("save", async function (next) {
//   this.wasNew = this.isNew; // Set a transient property to use in post-save hook

//   // Hash password if it's being set or modified
//   if (this.isModified("password")) {
//     try {
//       const salt = await bcrypt.genSalt(10);
//       this.password = await bcrypt.hash(this.password, salt);
//     } catch (error) {
//       return next(error);
//     }
//   }

//   // Hash pendingPassword if it's being set with a new value
//   if (this.isModified("pendingPassword") && this.pendingPassword) {
//     try {
//       const salt = await bcrypt.genSalt(10);
//       this.pendingPassword = await bcrypt.hash(this.pendingPassword, salt);
//     } catch (error) {
//       return next(error);
//     }
//   }

//   next();
// });

// // Method to compare password
// UserSchema.methods.comparePassword = async function (candidatePassword) {
//   return await bcrypt.compare(candidatePassword, this.password);
// };

// // Post-save hook to create a corresponding ledger for a new user.
// // This ensures that every new user gets a ledger entry automatically.
// UserSchema.post("save", async function () {
//   // Check the transient property to see if this was a new user.
//   if (this.wasNew) {
//     // We need to get the Ledger model dynamically to avoid circular dependencies
//     const Ledger = mongoose.model("Ledger");
//     try {
//       // Use findOneAndUpdate with upsert to create a ledger if it doesn't exist.
//       // This is an atomic operation and is safe from race conditions.
//       await Ledger.findOneAndUpdate(
//         { userId: this._id }, // query
//         {
//           $setOnInsert: {
//             // only set these values on creation
//             _id: this._id,
//             userId: this._id,
//             uhid: this.uhid,
//           },
//         },
//         {
//           upsert: true, // create if it doesn't exist
//           runValidators: true, // ensure schema validation is run
//         }
//       );
//     } catch (error) {
//       console.error(`Failed to create ledger for user ${this._id}:`, error);
//     }
//   }
// });

// module.exports = mongoose.model("User", UserSchema);
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  // Fields from original User.js / Auth-System
  email: {
    type: String,
    required: [true, "Please provide an email"],
    unique: true,
    match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/, "Please provide a valid email"],
  },
  username: {
    type: String,
    required: [true, "Please provide a username."],
    unique: true,
    trim: true,
    minlength: [3, "Username must be at least 3 characters long"],
    match: [/^[a-zA-Z0-9.\-_]+$/, "Username can only contain letters, numbers, and . - _"],
  },
  uhid: {
    type: String,
    required: [true, "Please provide a uhid."],
    unique: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, "Please provide a password."],
    minlength: [6, "Password must be at least 6 characters long"],
    select: false,
  },
  // Fields from existing user document for backward compatibility
  id: String, // Legacy ID from old system
  timestamp: String, // Legacy timestamp, new documents will use registrationTs

  joiningTimeStamp: {
    type: Date,
    default: Date.now,
  },

  country: {},
  countryCode: String,
  whatsappContact: { type: String, trim: true },

  // Verification and OTP related fields (from Auth-System, also present in USDT)
  isVerified: { type: Boolean, default: false }, // General verification status
  otp: String,
  otpExpiry: Date,
  isOtpVerified: { type: Boolean, default: false }, // Specific to email/phone OTP verification
  requiresPasswordChange: { type: Boolean, default: false }, // For initial password setup

  // ✅ Added for email verification by link (kept separate from isVerified/isOtpVerified)
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, default: null, select: false }, // store SHA-256 hash
  emailVerificationExpires: { type: Date, default: null, select: false },

  autopositioning: {
    type: Boolean,
    default: false,
  },

  // Fields for the two-step initial password setting flow
  pendingPassword: { type: String, select: false },
  passwordChangeOtp: { type: String, select: false },
  passwordChangeOtpExpiry: { type: Date, select: false },
  tokenVersion: { type: Number, default: 1 },
  registrationToken: String,
  registrationTokenExpires: Date,

  resetPasswordToken: String, // For password reset functionality
  resetPasswordExpires: Date, // Expiry for password reset token

  googleId: String, // For Google Sign-In users

  // Sponsor, Path, Level, Height (present in both, using USDT structure where applicable)
  sponsorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  path: {
    // Hierarchy path (root -> parent -> self)
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    default: [],
  },
  level: {
    // User's level in the hierarchy/network
    type: Number,
    default: 0,
    min: 0,
  },
  height: {
    // Max depth of the subtree rooted at this user
    type: Number,
    default: 0,
    min: 0,
  },

  // Fields specific to USDT model structure
  registrationTs: {
    type: Date,
    default: Date.now,
  },
  levelsOpen: {
    type: Number,
    default: 0,
    min: 0,
  },

  // Counters (from USDT model, includes directReferrals which replaces directDownlines)
  counters: {
    selfLp: {
      // LP deposited by the user themselves
      type: mongoose.Schema.Types.Decimal128,
      default: "0.0",
    },
    teamLpFirst3Lvls: {
      // Total LP from team members in the first 3 levels
      type: mongoose.Schema.Types.Decimal128,
      default: "0.0",
    },
    teamLpFirst5Lvls: {
      // Total LP from team members in the first 5 levels
      type: mongoose.Schema.Types.Decimal128,
      default: "0.0",
    },
    teamLpFirst16Lvls: {
      // Total LP from team members in the first 16 levels
      type: mongoose.Schema.Types.Decimal128,
      default: "0.0",
    },
    totalTeamLp: {
      // Total LP from all team members in the downline
      type: mongoose.Schema.Types.Decimal128,
      default: "0.0",
    },
  },

  // Balance fields from Auth-System (crucial for deposit controller)
  balanceUSDT: {
    // General USDT balance, possibly for other uses or legacy
    type: Number,
    default: 0,
    min: 0,
  },
  usdtBalance: {
    // Balance derived from on-chain deposits (managed by deposit controller)
    type: Number,
    default: 0,
    min: 0,
  },
  firstLpDepositTs: {
    type: Date,
    default: null,
  },

  wallet_address: {
    // User's BEP20 wallet address
    type: String,
    trim: true,
    default: null, // Or an empty string, depending on preference
  },

  notificationSettings: {
    successfulDeposits: { type: Boolean, default: true },
    withdrawalConfirmations: { type: Boolean, default: true },
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  communitySize: {
    // Total number of users in this user's downline (added from Auth system concept)
    type: Number,
    default: 0,
    min: 0,
  },
  directDownlines: {
    // Number of users directly sponsored by this user
    type: Number,
    default: 0,
    min: 0,
  },
  positioningRank: {
    type: String,
    enum: [null, "X1", "X2", "X3", "X4", "X5"],
    default: null,
  },
  xRank: {
    type: String,
    enum: [null, "X1", "X2", "X3", "X4", "X5"],
    default: null,
    index: true,
  },
  hasReceivedEligibilityEmail: {
  type: Boolean,
  default: false,
  },
  xRankLastUpdated: {
    type: Date,
    default: null,
  },
  paidRankBonuses: {
    type: [{ type: String }],
    default: [],
  },
  userType: {
    type: String,
    enum: ["user", "support", "admin", "superadmin"],
    default: "user",
  },
  totalReferrals: {
    type: Number,
    default: 0,
  },
  nftPackages: [{
    // nftType: 'horse' = legacy Horse NFT (starter/growth/premium)
    //          'mining' = new N1–N5 mining ecosystem tiers
    nftType: { type: String, enum: ["horse", "mining"], default: "horse" },

    // ── Common fields ─────────────────────────────────────────────────────────
    tier: {
      type: String,
      enum: ["starter", "growth", "premium", "N1", "N2", "N3", "N4", "N5"],
      required: true
    },
    mintPrice:   { type: Number, default: 0 },  // USDT paid at mint / purchase price
    purchaseDate: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "expired"], default: "active" },

    // ── Horse NFT fields (legacy) ─────────────────────────────────────────────
    bonusTokens:   { type: Number, default: 0 },   // Bonus Toking Tokens
    roi:           { type: String, default: "" },   // e.g. "Up to 25%"
    dividendFreq:  { type: String, default: "" },   // e.g. "Monthly"

    // ── N1–N5 Mining NFT fields ───────────────────────────────────────────────
    miningPower:        { type: Number, default: 0 },  // Raw mining power
    powerCoefficient:   { type: Number, default: 0 },  // 0.7 – 1.1
    poolMultiplier:     { type: Number, default: 2.0 }, // Base: 2.0×
    afterTSCMultiplier: { type: Number, default: 0 },  // Post-launch multiplier
  }],
  nodeTier: {
    type: String,
    enum: [null, "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"],
    default: null,
  },
  stakingPlans: [{
    amount: { type: Number, default: 0 },
    days: { type: Number, enum: [30, 90, 180, 365], required: true },
    startDate: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "completed"], default: "active" },
    tokenAmount: { type: Number, default: 0 }
  }],
  stakingPlan: {
    amount: { type: Number, default: 0 },
    days: { type: Number, default: 0 },
    startDate: { type: Date, default: Date.now },
    status: { type: String, default: "active" },
    tokenAmount: { type: Number, default: 0 }
  },
  phantomWalletAddress: {
    type: String,
    trim: true,
    default: null,
    index: true,
  },
  phantomWalletConnectedAt: {
    type: Date,
    default: null,
  },
  walletAuthNonce: {
    type: String,
    default: null,
    select: false,
  },
  walletAuthNonceExpiresAt: {
    type: Date,
    default: null,
    select: false,
  },
  // Note: Wallets and Limits might be handled by a separate Ledger document as per USDT model's original comment.
});

// Pre-save middleware to hash password
UserSchema.pre("save", async function (next) {
  this.wasNew = this.isNew; // Set a transient property to use in post-save hook

  // Hash password if it's being set or modified
  if (this.isModified("password")) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }

  // Hash pendingPassword if it's being set with a new value
  if (this.isModified("pendingPassword") && this.pendingPassword) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.pendingPassword = await bcrypt.hash(this.pendingPassword, salt);
    } catch (error) {
      return next(error);
    }
  }

  next();
});

// Method to compare password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Post-save hook to create a corresponding ledger for a new user.
// This ensures that every new user gets a ledger entry automatically.
UserSchema.post("save", async function () {
  // Check the transient property to see if this was a new user.
  if (this.wasNew) {
    // We need to get the Ledger model dynamically to avoid circular dependencies
    const Ledger = mongoose.model("Ledger");
    try {
      // Use findOneAndUpdate with upsert to create a ledger if it doesn't exist.
      // This is an atomic operation and is safe from race conditions.
      await Ledger.findOneAndUpdate(
        { userId: this._id }, // query
        {
          $setOnInsert: {
            // only set these values on creation
            _id: this._id,
            userId: this._id,
            uhid: this.uhid,
          },
        },
        {
          upsert: true, // create if it doesn't exist
          runValidators: true, // ensure schema validation is run
        }
      );
    } catch (error) {
      console.error(`Failed to create ledger for user ${this._id}:`, error);
    }
  }
});

module.exports = mongoose.model("User", UserSchema);
