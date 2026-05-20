const {
  ALLOWED_DIVIDEND_FREQUENCIES,
  ALLOWED_TIER_CODES,
  listHorseNftPackages,
  sanitizeBenefits,
  seedDefaultHorseNftPackages,
  updateHorseNftPackage,
} = require("../Services/horseNftPackageService");
const {
  listAdminHorseNftPurchases,
} = require("../Services/horseNftPurchaseService");
const {
  listAdminHorseNftPayouts,
  runHorseNftPayouts,
} = require("../Services/horseNftPayoutService");

function isNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

exports.getAdminHorseNftPackages = async (req, res) => {
  try {
    const packages = await listHorseNftPackages({ activeOnly: false });
    return res.status(200).json({
      success: true,
      data: packages,
    });
  } catch (error) {
    console.error("Admin get Horse NFT packages error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT packages.",
    });
  }
};

exports.seedHorseNftPackages = async (req, res) => {
  try {
    const packages = await seedDefaultHorseNftPackages();
    return res.status(200).json({
      success: true,
      message: "Horse NFT packages seeded successfully.",
      data: packages,
    });
  } catch (error) {
    console.error("Seed Horse NFT packages error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to seed Horse NFT packages.",
    });
  }
};

exports.updateHorseNftPackage = async (req, res) => {
  try {
    const { tierCode } = req.params;
    if (!ALLOWED_TIER_CODES.has(tierCode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tierCode. Expected starter, growth, or premium.",
      });
    }

    const updates = {};
    const allowedStringFields = ["displayName", "tierName", "imageKey"];
    for (const field of allowedStringFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] === null ? null : String(req.body[field]).trim();
      }
    }

    const numberFields = [
      "priceUSDT",
      "bonusTokens",
      "annualRoiPercent",
      "sortOrder",
    ];
    for (const field of numberFields) {
      if (req.body[field] !== undefined) {
        if (!isNonNegativeNumber(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: `${field} must be a number greater than or equal to 0.`,
          });
        }
        updates[field] = Number(req.body[field]);
      }
    }

    if (req.body.dividendFrequency !== undefined) {
      if (!ALLOWED_DIVIDEND_FREQUENCIES.has(req.body.dividendFrequency)) {
        return res.status(400).json({
          success: false,
          message: "dividendFrequency must be weekly, monthly, or quarterly.",
        });
      }
      updates.dividendFrequency = req.body.dividendFrequency;
    }

    if (req.body.benefits !== undefined) {
      if (!Array.isArray(req.body.benefits)) {
        return res.status(400).json({
          success: false,
          message: "benefits must be an array of strings.",
        });
      }
      updates.benefits = sanitizeBenefits(req.body.benefits);
    }

    if (req.body.isActive !== undefined) {
      updates.isActive = Boolean(req.body.isActive);
    }

    const updated = await updateHorseNftPackage(tierCode, updates);
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Horse NFT package not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Horse NFT package ${tierCode} updated successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error("Update Horse NFT package error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update Horse NFT package.",
      error: error.message,
    });
  }
};

exports.getAdminHorseNftPurchases = async (req, res) => {
  try {
    const result = await listAdminHorseNftPurchases({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      tierCode: req.query.tierCode,
      userId: req.query.userId,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Admin get Horse NFT purchases error:", error);

    if (error.message === "INVALID_USER_ID") {
      return res.status(400).json({
        success: false,
        message: "Invalid userId filter.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT purchases.",
    });
  }
};

exports.getAdminHorseNftPayouts = async (req, res) => {
  try {
    const result = await listAdminHorseNftPayouts({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      tierCode: req.query.tierCode,
      userId: req.query.userId,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Admin get Horse NFT payouts error:", error);

    if (error.message === "INVALID_USER_ID") {
      return res.status(400).json({
        success: false,
        message: "Invalid userId filter.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT payouts.",
    });
  }
};

exports.runAdminHorseNftPayout = async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const result = await runHorseNftPayouts({
      dryRun,
      userHorseNftId: req.body?.userHorseNftId || null,
      triggeredBy: `ADMIN:${req.user?._id?.toString?.() || "UNKNOWN"}`,
    });

    return res.status(200).json({
      success: true,
      message: dryRun
        ? "Horse NFT payout dry run completed."
        : "Horse NFT payout run completed.",
      data: result,
    });
  } catch (error) {
    console.error("Admin run Horse NFT payout error:", error);

    if (error.message === "INVALID_USER_HORSE_NFT_ID") {
      return res.status(400).json({
        success: false,
        message: "Invalid userHorseNftId.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to run Horse NFT payouts.",
      error: error.message,
    });
  }
};
