const mongoose = require("mongoose");
const Decimal = require("decimal.js");
const User = require("../../../../models/User");
const Ledger = require("../../../../models/Ledger");
const { createLedgerEntry } = require("../../../../jobs/helpers/ledgerHelpers");
const { addDecimal128, ensureDecimal128 } = require("../../../../utils/decimal128Utils");
const HorseNftPayout = require("../Models/HorseNftPayout");
const UserHorseNft = require("../Models/UserHorseNft");
const {
  addFrequency,
  normalizePagination,
  serializeUserHorseNft,
} = require("./horseNftPurchaseService");

function toAmountNumber(decimalValue) {
  return Number(new Decimal(decimalValue).toDecimalPlaces(6, Decimal.ROUND_DOWN).toString());
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

function calculateHorseNftPayoutAmount({ purchasePriceUSDT, annualRoiPercent, dividendFrequency }) {
  const yearlyAmount = new Decimal(purchasePriceUSDT || 0)
    .times(new Decimal(annualRoiPercent || 0))
    .div(100);

  if (dividendFrequency === "weekly") {
    return toAmountNumber(yearlyAmount.div(52));
  }

  if (dividendFrequency === "monthly") {
    return toAmountNumber(yearlyAmount.div(12));
  }

  return toAmountNumber(yearlyAmount.div(4));
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

  ledger.wallets.bnb = ensureDecimal128(ledger.wallets.bnb || "0.0");
  return ledger;
}

async function creditInternalUsdtWallet({
  userId,
  amount,
  narrative,
  refId,
  session = null,
}) {
  const amountD128 = ensureDecimal128(String(amount));
  const ledger = await getOrCreateLedgerForSession(userId, session);
  ledger.wallets.bnb = addDecimal128(ledger.wallets.bnb || "0.0", amountD128);
  ledger.markModified("wallets");
  await ledger.save(session ? { session } : undefined);

  await createLedgerEntry(
    {
      userId,
      eventType: "HORSE_NFT_PAYOUT",
      amount: Number(amount),
      walletFrom: "SYSTEM",
      walletTo: "USDT",
      narrative,
      refId,
    },
    session
  );

  return ledger;
}

function serializeHorseNftPayout(doc) {
  if (!doc) return null;

  const obj = doc.toJSON ? doc.toJSON() : doc;
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
    userHorseNft:
      typeof obj.userHorseNft === "object" && obj.userHorseNft?._id
        ? serializeUserHorseNft(obj.userHorseNft)
        : obj.userHorseNft?.toString?.() || obj.userHorseNft || null,
    package:
      typeof obj.package === "object" && obj.package?._id
        ? {
            id: obj.package._id.toString(),
            tierCode: obj.package.tierCode,
            displayName: obj.package.displayName,
            tierName: obj.package.tierName,
          }
        : obj.package?.toString?.() || obj.package || null,
    tierCode: obj.tierCode,
    payoutAsset: obj.payoutAsset,
    payoutAmountUSDT: Number(obj.payoutAmountUSDT || 0),
    payoutPeriodStart: obj.payoutPeriodStart,
    payoutPeriodEnd: obj.payoutPeriodEnd,
    status: obj.status,
    idempotencyKey: obj.idempotencyKey,
    failureReason: obj.failureReason || null,
    paidAt: obj.paidAt || null,
    metadata: obj.metadata || {},
    createdAt: obj.createdAt || null,
    updatedAt: obj.updatedAt || null,
  };
}

async function listUserHorseNftPayouts({ userId, page = 1, limit = 20 }) {
  const { page: pageNum, limit: limitNum, skip } = normalizePagination({
    page,
    limit,
  });

  const [items, total] = await Promise.all([
    HorseNftPayout.find({ user: userId })
      .populate("package", "tierCode displayName tierName")
      .populate("userHorseNft")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    HorseNftPayout.countDocuments({ user: userId }),
  ]);

  return {
    data: items.map(serializeHorseNftPayout),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

async function listAdminHorseNftPayouts({
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
    HorseNftPayout.find(query)
      .populate("package", "tierCode displayName tierName")
      .populate("user", "username email uhid userType")
      .populate("userHorseNft")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    HorseNftPayout.countDocuments(query),
  ]);

  return {
    data: items.map(serializeHorseNftPayout),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

async function buildEligiblePayoutTargets({ userHorseNftId = null, now = new Date() } = {}) {
  const query = {
    status: "ACTIVE",
    paymentStatus: "PAID",
    nextPayoutAt: { $ne: null, $lte: now },
  };

  if (userHorseNftId) {
    if (!mongoose.Types.ObjectId.isValid(userHorseNftId)) {
      throw new Error("INVALID_USER_HORSE_NFT_ID");
    }
    query._id = userHorseNftId;
  }

  return UserHorseNft.find(query)
    .populate("package")
    .sort({ nextPayoutAt: 1, createdAt: 1 });
}

async function runHorseNftPayouts({
  dryRun = false,
  userHorseNftId = null,
  triggeredBy = "SYSTEM",
}) {
  const now = new Date();
  const eligiblePurchases = await buildEligiblePayoutTargets({
    userHorseNftId,
    now,
  });

  const summary = {
    dryRun: Boolean(dryRun),
    eligibleCount: eligiblePurchases.length,
    processedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    totalPaidUSDT: 0,
    previews: [],
    processed: [],
    skipped: [],
    failures: [],
  };

  if (eligiblePurchases.length === 0) {
    return summary;
  }

  const sessionSupported = getMongoSessionSupport();

  for (const purchase of eligiblePurchases) {
    const payoutPeriodStart =
      purchase.lastPayoutAt || purchase.activatedAt || purchase.purchasedAt || purchase.createdAt;
    const payoutPeriodEnd = purchase.nextPayoutAt;

    if (!payoutPeriodStart || !payoutPeriodEnd) {
      summary.skippedCount += 1;
      summary.skipped.push({
        userHorseNftId: purchase._id.toString(),
        reason: "MISSING_PAYOUT_DATES",
      });
      continue;
    }

    const idempotencyKey = `horse-nft:${purchase._id.toString()}:${new Date(
      payoutPeriodStart
    ).toISOString()}:${new Date(payoutPeriodEnd).toISOString()}`;
    const payoutAmountUSDT = calculateHorseNftPayoutAmount({
      purchasePriceUSDT: purchase.purchasePriceUSDT,
      annualRoiPercent: purchase.annualRoiPercent,
      dividendFrequency: purchase.dividendFrequency,
    });

    const preview = {
      userHorseNftId: purchase._id.toString(),
      userId: purchase.user.toString(),
      tierCode: purchase.tierCode,
      payoutAmountUSDT,
      payoutPeriodStart,
      payoutPeriodEnd,
      idempotencyKey,
    };

    const existingPayout = await HorseNftPayout.findOne({ idempotencyKey });
    if (existingPayout) {
      summary.skippedCount += 1;
      summary.skipped.push({
        ...preview,
        reason: "DUPLICATE_IDEMPOTENCY_KEY",
      });
      continue;
    }

    if (dryRun) {
      summary.previews.push(preview);
      continue;
    }

    if (!sessionSupported) {
      try {
        await HorseNftPayout.create({
          user: purchase.user,
          userHorseNft: purchase._id,
          package: purchase.package?._id || purchase.package,
          tierCode: purchase.tierCode,
          payoutAsset: "USDT",
          payoutAmountUSDT,
          payoutPeriodStart,
          payoutPeriodEnd,
          status: "SKIPPED",
          idempotencyKey,
          failureReason: "Automatic payout credit unavailable in current DB topology.",
          metadata: {
            triggeredBy,
            dividendFrequency: purchase.dividendFrequency,
          },
        });
      } catch (writeError) {
        // Ignore duplicate write races here and treat the payout as skipped.
      }

      summary.skippedCount += 1;
      summary.skipped.push({
        ...preview,
        reason: "AUTO_CREDIT_UNAVAILABLE",
      });
      continue;
    }

    const session = sessionSupported ? await mongoose.startSession() : null;

    try {
      if (!session) {
        throw new Error("HORSE_NFT_PAYOUT_SESSION_REQUIRED");
      }

      session.startTransaction();

      const freshPurchase = await UserHorseNft.findById(purchase._id).session(session);
      if (!freshPurchase) {
        throw new Error("HORSE_NFT_PURCHASE_NOT_FOUND");
      }

      const duplicateCheck = await HorseNftPayout.findOne({ idempotencyKey }).session(session);
      if (duplicateCheck) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        session.endSession();
        summary.skippedCount += 1;
        summary.skipped.push({
          ...preview,
          reason: "DUPLICATE_IDEMPOTENCY_KEY",
        });
        continue;
      }

      const [payout] = await HorseNftPayout.create(
        [
          {
            user: freshPurchase.user,
            userHorseNft: freshPurchase._id,
            package: freshPurchase.package,
            tierCode: freshPurchase.tierCode,
            payoutAsset: "USDT",
            payoutAmountUSDT,
            payoutPeriodStart,
            payoutPeriodEnd,
            status: "PAID",
            idempotencyKey,
            paidAt: now,
            metadata: {
              triggeredBy,
              dividendFrequency: freshPurchase.dividendFrequency,
            },
          },
        ],
        { session }
      );

      await creditInternalUsdtWallet({
        userId: freshPurchase.user,
        amount: payoutAmountUSDT,
        narrative: `Horse NFT payout for ${freshPurchase.displayName} (${freshPurchase.tierCode})`,
        refId: payout._id.toString(),
        session,
      });

      freshPurchase.totalPaidUSDT = toAmountNumber(
        new Decimal(freshPurchase.totalPaidUSDT || 0).plus(payoutAmountUSDT)
      );
      freshPurchase.totalPayoutCount = Number(freshPurchase.totalPayoutCount || 0) + 1;
      freshPurchase.lastPayoutAt = payoutPeriodEnd;
      freshPurchase.nextPayoutAt = addFrequency(
        payoutPeriodEnd,
        freshPurchase.dividendFrequency
      );
      await freshPurchase.save({ session });

      await session.commitTransaction();
      session.endSession();

      summary.processedCount += 1;
      summary.totalPaidUSDT = toAmountNumber(
        new Decimal(summary.totalPaidUSDT).plus(payoutAmountUSDT)
      );
      summary.processed.push({
        ...preview,
        payoutId: payout._id.toString(),
      });
    } catch (error) {
      if (session) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        session.endSession();
      }

      summary.failedCount += 1;
      summary.failures.push({
        ...preview,
        reason: error.message || "HORSE_NFT_PAYOUT_FAILED",
      });

      try {
        await HorseNftPayout.create({
          user: purchase.user,
          userHorseNft: purchase._id,
          package: purchase.package?._id || purchase.package,
          tierCode: purchase.tierCode,
          payoutAsset: "USDT",
          payoutAmountUSDT,
          payoutPeriodStart,
          payoutPeriodEnd,
          status: "FAILED",
          idempotencyKey,
          failureReason: error.message || "HORSE_NFT_PAYOUT_FAILED",
          metadata: {
            triggeredBy,
            dividendFrequency: purchase.dividendFrequency,
          },
        });
      } catch (writeFailure) {
        // Ignore duplicate or follow-up write failures so the cron never crashes.
      }
    }
  }

  return summary;
}

module.exports = {
  calculateHorseNftPayoutAmount,
  serializeHorseNftPayout,
  listUserHorseNftPayouts,
  listAdminHorseNftPayouts,
  runHorseNftPayouts,
};
