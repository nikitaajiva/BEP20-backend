const mongoose = require("mongoose");
const User = require("../../../../models/User");
const Ledger = require("../../../../models/Ledger");
const { createLedgerEntry } = require("../../../../jobs/helpers/ledgerHelpers");
const {
  addDecimal128,
  subtractDecimal128,
  compareDecimal128,
  ensureDecimal128,
} = require("../../../../utils/decimal128Utils");
const { creditTkc } = require("../../../../services/internalTokenLedgerService");
const HorseNftPackage = require("../Models/HorseNftPackage");
const UserHorseNft = require("../Models/UserHorseNft");
const {
  ALLOWED_TIER_CODES,
  getHorseNftPackageByTierCode,
  serializeHorseNftPackage,
} = require("./horseNftPackageService");

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizePagination({ page = 1, limit = 20 } = {}) {
  const pageNum = Math.max(toPositiveInt(page, 1), 1);
  const limitNum = Math.min(Math.max(toPositiveInt(limit, 20), 1), 100);
  return {
    page: pageNum,
    limit: limitNum,
    skip: (pageNum - 1) * limitNum,
  };
}

function getMongoSessionSupport() {
  const client = mongoose.connection.getClient();
  const topologyType = client?.topology?.description?.type;

  return (
    topologyType === "ReplicaSetWithPrimary" ||
    topologyType === "ReplicaSetNoPrimary" ||
    topologyType === "Sharded"
  );
}

function addFrequency(dateValue, dividendFrequency) {
  const date = new Date(dateValue);

  if (dividendFrequency === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
    return date;
  }

  if (dividendFrequency === "monthly") {
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date;
  }

  date.setUTCMonth(date.getUTCMonth() + 3);
  return date;
}

function formatLegacyRoiLabel(annualRoiPercent) {
  return `Up to ${Number(annualRoiPercent || 0)}% annual ROI`;
}

function formatLegacyDividendFrequency(dividendFrequency) {
  if (!dividendFrequency) return "";
  return dividendFrequency.charAt(0).toUpperCase() + dividendFrequency.slice(1);
}

async function syncLegacyHorsePackage({
  userId,
  tierCode,
  packageSnapshot,
  purchaseDate,
  session = null,
}) {
  let query = User.findById(userId);
  if (session) {
    query = query.session(session);
  }

  const user = await query;
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  if (!Array.isArray(user.nftPackages)) {
    user.nftPackages = [];
  }

  user.nftPackages.push({
    nftType: "horse",
    tier: tierCode,
    mintPrice: Number(packageSnapshot.purchasePriceUSDT || 0),
    purchaseDate: purchaseDate || new Date(),
    status: "active",
    bonusTokens: Number(packageSnapshot.bonusTokens || 0),
    roi: formatLegacyRoiLabel(packageSnapshot.annualRoiPercent),
    dividendFreq: formatLegacyDividendFrequency(packageSnapshot.dividendFrequency),
  });

  await user.save(session ? { session } : undefined);
}

async function getOrCreateLedgerForSession(userId, session = null) {
  let query = Ledger.findOne({ userId });
  if (session) {
    query = query.session(session);
  }

  let ledger = await query;
  if (!ledger) {
    let userQuery = User.findById(userId).select("uhid");
    if (session) {
      userQuery = userQuery.session(session);
    }

    const user = await userQuery;
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    ledger = new Ledger({
      _id: userId,
      userId,
      uhid: user.uhid,
    });
  }

  if (!ledger.wallets) {
    ledger.wallets = {};
  }

  // NOTE: In this codebase, wallets.bnb acts as the primary USDT balance alias.
  // Native/BEP20 deposits and withdrawals use wallets.bnb to represent USDT.
  ledger.wallets.bnb = ensureDecimal128(ledger.wallets.bnb || "0.0");
  return ledger;
}

async function debitInternalUsdtWallet({
  userId,
  amount,
  narrative,
  refId,
  session = null,
}) {
  const amountD128 = ensureDecimal128(String(amount));
  const ledger = await getOrCreateLedgerForSession(userId, session);
  // Using ledger.wallets.bnb as the internal USDT wallet balance
  const currentBalance = ensureDecimal128(ledger.wallets.bnb || "0.0");

  if (compareDecimal128(currentBalance, amountD128) < 0) {
    throw new Error("INSUFFICIENT_INTERNAL_USDT_BALANCE");
  }

  ledger.wallets.bnb = subtractDecimal128(currentBalance, amountD128);
  ledger.markModified("wallets");
  await ledger.save(session ? { session } : undefined);

  await createLedgerEntry(
    {
      userId,
      eventType: "HORSE_NFT_PURCHASE",
      amount: Number(amount),
      walletFrom: "USDT",
      walletTo: "HORSE_NFT",
      narrative,
      refId,
    },
    session
  );

  return ledger;
}

function serializeUserHorseNft(doc) {
  if (!doc) return null;

  const obj = doc.toJSON ? doc.toJSON() : doc;
  const packageDoc =
    obj.package && typeof obj.package === "object" && obj.package._id
      ? serializeHorseNftPackage(obj.package)
      : obj.packageInfo || null;

  return {
    id: obj._id?.toString?.() || obj.id || null,
    user: typeof obj.user === "object" && obj.user?._id
      ? {
          id: obj.user._id.toString(),
          username: obj.user.username || null,
          email: obj.user.email || null,
          uhid: obj.user.uhid || null,
        }
      : obj.user?.toString?.() || obj.user || null,
    packageId:
      typeof obj.package === "object" && obj.package?._id
        ? obj.package._id.toString()
        : obj.package?.toString?.() || obj.package || null,
    packageInfo: packageDoc,
    tierCode: obj.tierCode,
    displayName: obj.displayName,
    purchasePriceUSDT: Number(obj.purchasePriceUSDT || 0),
    bonusTokens: Number(obj.bonusTokens || 0),
    annualRoiPercent: Number(obj.annualRoiPercent || 0),
    dividendFrequency: obj.dividendFrequency,
    status: obj.status,
    paymentAsset: obj.paymentAsset,
    paymentStatus: obj.paymentStatus,
    paymentReference: obj.paymentReference || null,
    purchasedAt: obj.purchasedAt || null,
    activatedAt: obj.activatedAt || null,
    nextPayoutAt: obj.nextPayoutAt || null,
    totalPaidUSDT: Number(obj.totalPaidUSDT || 0),
    totalPayoutCount: Number(obj.totalPayoutCount || 0),
    lastPayoutAt: obj.lastPayoutAt || null,
    metadata: obj.metadata || {},
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
  };
}

async function createHorseNftPurchase({
  userId,
  tierCode,
  idempotencyKey = null,
  paymentReference = null,
  requestSource = "API",
}) {
  if (!ALLOWED_TIER_CODES.has(tierCode)) {
    throw new Error("INVALID_TIER_CODE");
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("INVALID_USER_ID");
  }

  if (idempotencyKey) {
    const existing = await UserHorseNft.findOne({
      user: userId,
      "metadata.idempotencyKey": idempotencyKey,
    }).populate("package");

    if (existing) {
      return {
        successState: existing.status === "ACTIVE" ? "ACTIVE" : "PENDING",
        wasExisting: true,
        purchase: serializeUserHorseNft(existing),
        message:
          existing.status === "ACTIVE"
            ? "Horse NFT purchase already processed."
            : "Horse NFT purchase request already exists and is pending payment.",
      };
    }
  }

  const packageDoc = await getHorseNftPackageByTierCode(tierCode);
  if (!packageDoc) {
    throw new Error("HORSE_NFT_PACKAGE_NOT_FOUND");
  }

  const priceUSDT = Number(packageDoc.priceUSDT);

  // Check balance BEFORE creating the purchase record
  const ledgerCheck = await Ledger.findOne({ userId });
  const currentBal = ledgerCheck
    ? Number((ledgerCheck.wallets?.bnb || "0").toString())
    : 0;

  if (currentBal < priceUSDT) {
    throw new Error("INSUFFICIENT_INTERNAL_USDT_BALANCE");
  }

  const baseMetadata = {
    requestSource,
    idempotencyKey: idempotencyKey || null,
    bonusTokensCredited: false,
    autoActivationAttempted: true,
  };

  const now = new Date();

  // Create purchase record as PENDING_PAYMENT first
  const createdPurchase = await UserHorseNft.create({
    user: userId,
    package: packageDoc._id,
    tierCode: packageDoc.tierCode,
    displayName: packageDoc.displayName,
    purchasePriceUSDT: priceUSDT,
    bonusTokens: Number(packageDoc.bonusTokens),
    annualRoiPercent: Number(packageDoc.annualRoiPercent),
    dividendFrequency: packageDoc.dividendFrequency,
    status: "PENDING_PAYMENT",
    paymentAsset: "USDT",
    paymentStatus: "PENDING",
    paymentReference: paymentReference || null,
    purchasedAt: now,
    metadata: baseMetadata,
  });

  try {
    // 1. Debit internal USDT wallet (wallets.bnb = USDT balance)
    await debitInternalUsdtWallet({
      userId,
      amount: priceUSDT,
      narrative: `Horse NFT purchase: ${packageDoc.displayName} (${packageDoc.tierCode})`,
      refId: createdPurchase._id.toString(),
      session: null,
    });

    // 2. Credit bonus tokens
    await creditTkc({
      userId,
      amount: Number(packageDoc.bonusTokens),
      type: "HORSE_NFT_BONUS",
      idempotencyKey: `HORSE_NFT_BONUS:${createdPurchase._id.toString()}`,
      referenceId: createdPurchase._id.toString(),
      metadata: {
        tierCode: packageDoc.tierCode,
        displayName: packageDoc.displayName,
        source: "HORSE_NFT_PURCHASE",
      },
    });

    // 3. Activate the purchase
    const activatedPurchase = await UserHorseNft.findByIdAndUpdate(
      createdPurchase._id,
      {
        $set: {
          status: "ACTIVE",
          paymentStatus: "PAID",
          paymentReference:
            paymentReference || `HORSE_NFT:${createdPurchase._id.toString()}`,
          activatedAt: now,
          nextPayoutAt: addFrequency(now, packageDoc.dividendFrequency),
          metadata: {
            ...baseMetadata,
            autoActivationAttempted: true,
            bonusTokensCredited: true,
            activatedFromInternalUsdtBalance: true,
          },
        },
      },
      { new: true }
    ).populate("package");

    // 4. Sync legacy horseNFTs array on User document
    await syncLegacyHorsePackage({
      userId,
      tierCode: packageDoc.tierCode,
      packageSnapshot: activatedPurchase,
      purchaseDate: now,
      session: null,
    });

    return {
      successState: "ACTIVE",
      wasExisting: false,
      purchase: serializeUserHorseNft(activatedPurchase),
      message: `${packageDoc.displayName} activated successfully.`,
    };
  } catch (error) {
    // Mark the purchase as FAILED on unexpected errors
    await UserHorseNft.findByIdAndUpdate(createdPurchase._id, {
      $set: {
        paymentStatus: "FAILED",
        metadata: {
          ...baseMetadata,
          failureReason: error.message || "Purchase processing failed.",
        },
      },
    });

    throw error;
  }
}

async function listUserHorseNfts({
  userId,
  page = 1,
  limit = 20,
  status,
}) {
  const { page: pageNum, limit: limitNum, skip } = normalizePagination({
    page,
    limit,
  });

  const query = { user: userId };
  if (status) {
    query.status = status;
  }

  const [items, total] = await Promise.all([
    UserHorseNft.find(query)
      .populate("package")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    UserHorseNft.countDocuments(query),
  ]);

  return {
    data: items.map(serializeUserHorseNft),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

async function getUserHorseNftById({ userId, horseNftId }) {
  if (!mongoose.Types.ObjectId.isValid(horseNftId)) {
    throw new Error("INVALID_HORSE_NFT_ID");
  }

  const item = await UserHorseNft.findOne({
    _id: horseNftId,
    user: userId,
  }).populate("package");

  return serializeUserHorseNft(item);
}

async function listAdminHorseNftPurchases({
  page = 1,
  limit = 20,
  status,
  tierCode,
  userId,
}) {
  const { page: pageNum, limit: limitNum, skip } = normalizePagination({
    page,
    limit,
  });

  const query = {};

  if (status) {
    query.status = status;
  }

  if (tierCode) {
    query.tierCode = tierCode;
  }

  if (userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("INVALID_USER_ID");
    }
    query.user = userId;
  }

  const [items, total] = await Promise.all([
    UserHorseNft.find(query)
      .populate("package")
      .populate("user", "username email uhid userType")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    UserHorseNft.countDocuments(query),
  ]);

  return {
    data: items.map(serializeUserHorseNft),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

module.exports = {
  addFrequency,
  normalizePagination,
  serializeUserHorseNft,
  createHorseNftPurchase,
  listUserHorseNfts,
  getUserHorseNftById,
  listAdminHorseNftPurchases,
};
