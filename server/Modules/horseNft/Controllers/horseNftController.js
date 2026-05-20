const {
  ALLOWED_TIER_CODES,
  listHorseNftPackages,
} = require("../Services/horseNftPackageService");
const {
  createHorseNftPurchase,
  getUserHorseNftById,
  listUserHorseNfts,
} = require("../Services/horseNftPurchaseService");
const {
  listUserHorseNftPayouts,
} = require("../Services/horseNftPayoutService");

exports.getPublicHorseNftPackages = async (req, res) => {
  try {
    const packages = await listHorseNftPackages({ activeOnly: true });
    return res.status(200).json({
      success: true,
      data: packages,
    });
  } catch (error) {
    console.error("Get horse NFT packages error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT packages.",
    });
  }
};

exports.purchaseHorseNft = async (req, res) => {
  try {
    const { tierCode } = req.body || {};

    if (!tierCode || !ALLOWED_TIER_CODES.has(tierCode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tierCode. Expected starter, growth, or premium.",
      });
    }

    const result = await createHorseNftPurchase({
      userId: req.user._id,
      tierCode,
      idempotencyKey:
        req.headers["x-idempotency-key"] ||
        req.body?.idempotencyKey ||
        null,
      paymentReference: req.body?.paymentReference || null,
      requestSource: "HORSE_NFT_API",
    });

    return res.status(result.wasExisting ? 200 : 201).json({
      success: true,
      message: result.message,
      data: result.purchase,
    });
  } catch (error) {
    console.error("Purchase Horse NFT error:", error);

    if (error.message === "HORSE_NFT_PACKAGE_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Horse NFT package not found or inactive.",
      });
    }

    if (error.message === "INSUFFICIENT_INTERNAL_USDT_BALANCE") {
      return res.status(402).json({
        success: false,
        message: "Insufficient USDT balance to purchase this Horse NFT package.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create Horse NFT purchase.",
      error: error.message,
    });
  }
};

exports.getMyHorseNfts = async (req, res) => {
  try {
    const result = await listUserHorseNfts({
      userId: req.user._id,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Get my Horse NFTs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT purchases.",
    });
  }
};

exports.getMyHorseNftById = async (req, res) => {
  try {
    const item = await getUserHorseNftById({
      userId: req.user._id,
      horseNftId: req.params.id,
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Horse NFT purchase not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error("Get Horse NFT purchase by id error:", error);

    if (error.message === "INVALID_HORSE_NFT_ID") {
      return res.status(400).json({
        success: false,
        message: "Invalid Horse NFT purchase id.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT purchase.",
    });
  }
};

exports.getMyHorseNftPayoutHistory = async (req, res) => {
  try {
    const result = await listUserHorseNftPayouts({
      userId: req.user._id,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error("Get Horse NFT payout history error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch Horse NFT payout history.",
    });
  }
};
