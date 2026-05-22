const mongoose = require("mongoose");
const NftTier = require("../models/NftTier");
const ProtocolConfig = require("../models/ProtocolConfig");
const UserNft = require("../models/UserNft");
const { debitInternalSolWallet } = require("../services/internalWalletService");
const { creditTscAvailable } = require("../services/internalTokenLedgerService");

const toNumber = (value) => Number(value?.toString?.() || value || 0);

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(String(value || "0"));

const serializeDecimal = (value) => value?.toString?.() || "0";

const serializeUserNft = (nft) => {
  const obj = nft.toJSON ? nft.toJSON() : nft;

  return {
    ...obj,
    mintPriceU: serializeDecimal(obj.mintPriceU),
    miningPower: serializeDecimal(obj.miningPower),
    powerCoefficient: serializeDecimal(obj.powerCoefficient),
    poolMultiplierBeforeTsc: serializeDecimal(obj.poolMultiplierBeforeTsc),
    poolMultiplierAfterTsc: serializeDecimal(obj.poolMultiplierAfterTsc),
    currentPoolMultiplier: serializeDecimal(obj.currentPoolMultiplier),
    dailyYieldRatePercent: serializeDecimal(obj.dailyYieldRatePercent),
    tscAllocationAmount: serializeDecimal(obj.tscAllocationAmount),
    paymentAmount: serializeDecimal(obj.paymentAmount),
  };
};

const generateNftSerialNo = async (tierCode, session = null) => {
  const count = await UserNft.countDocuments({ tierCode }).session(session);
  return `${tierCode}-${String(count + 1).padStart(6, "0")}`;
};

const calculateTscAllocation = ({ tier, protocolConfig }) => {
  const mintPriceU = toNumber(tier.mintPriceU);
  const tscPrice = toNumber(protocolConfig.tscInitialPriceUSDT);

  if (!Number.isFinite(mintPriceU) || mintPriceU <= 0) {
    throw new Error("INVALID_TIER_MINT_PRICE");
  }

  if (!Number.isFinite(tscPrice) || tscPrice <= 0) {
    throw new Error("INVALID_TSC_PRICE");
  }

  return mintPriceU / tscPrice;
};

exports.getPublicNftTiers = async (req, res) => {
  try {
    const tiers = await NftTier.find({ isActive: true }).sort({ sortOrder: 1 }).lean();

    return res.status(200).json({
      success: true,
      data: tiers.map((tier) => ({
        ...tier,
        mintPriceU: serializeDecimal(tier.mintPriceU),
        miningPower: serializeDecimal(tier.miningPower),
        powerCoefficient: serializeDecimal(tier.powerCoefficient),
        poolMultiplierBeforeTsc: serializeDecimal(tier.poolMultiplierBeforeTsc),
        poolMultiplierAfterTsc: serializeDecimal(tier.poolMultiplierAfterTsc),
        dailyYieldRatePercent: serializeDecimal(tier.dailyYieldRatePercent),
      })),
    });
  } catch (error) {
    console.error("Get NFT tiers error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch NFT tiers.",
    });
  }
};

exports.mintNft = async (req, res) => {
  const client = mongoose.connection.getClient();
  const topologyType = client?.topology?.description?.type;
  const useTransaction = topologyType === "ReplicaSetWithPrimary" || topologyType === "ReplicaSetNoPrimary" || topologyType === "Sharded";

  const session = useTransaction ? await mongoose.startSession() : null;
  if (session) {
    session.startTransaction();
  }

  try {
    const userId = req.user._id;
    const { tierCode, paymentAsset = "SOL", idempotencyKey } = req.body || {};

    if (!tierCode) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        message: "tierCode is required.",
      });
    }

    if (idempotencyKey) {
      const RewardTransaction = require("../models/RewardTransaction");
      const existingTx = await RewardTransaction.findOne({ idempotencyKey }).session(session);
      if (existingTx) {
        const existingNft = await UserNft.findById(existingTx.referenceId || existingTx.sourceNft).session(session);
        if (existingNft) {
          if (session) {
            await session.abortTransaction();
            session.endSession();
          }
          return res.status(200).json({
            success: true,
            message: "NFT already minted (idempotent).",
            data: serializeUserNft(existingNft),
          });
        }
      }
    }

    const tier = await NftTier.findOne({ code: tierCode, isActive: true }).session(session);

    if (!tier) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        message: "NFT tier not found or inactive.",
      });
    }

    const protocolConfig = await ProtocolConfig.findOne({ key: "default" }).session(session);

    if (!protocolConfig) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(500).json({
        success: false,
        message: "Protocol config missing. Please seed config first.",
      });
    }

    const mintPrice = toNumber(tier.mintPriceU);
    const allocationAmount = calculateTscAllocation({ tier, protocolConfig });

    // 1. Debit SOL/internal payment balance.
    await debitInternalSolWallet({
      userId,
      amountSol: mintPrice,
      session,
    });

    // 2. Create NFT snapshot.
    const currentMultiplier = protocolConfig.isTscLaunched
      ? tier.poolMultiplierAfterTsc
      : tier.poolMultiplierBeforeTsc;

    const serialNo = await generateNftSerialNo(tier.code, session);

    const [createdNft] = await UserNft.create(
      [
        {
          user: userId,
          tierCode: tier.code,
          tierName: tier.name,
          serialNo,
          mintPriceU: tier.mintPriceU,
          miningPower: tier.miningPower,
          powerCoefficient: tier.powerCoefficient,
          poolMultiplierBeforeTsc: tier.poolMultiplierBeforeTsc,
          poolMultiplierAfterTsc: tier.poolMultiplierAfterTsc,
          currentPoolMultiplier: currentMultiplier,
          dailyYieldRatePercent: tier.dailyYieldRatePercent,
          tscAllocationAmount: toDecimal128(allocationAmount),
          status: "MINTED",
          paymentAsset,
          paymentAmount: tier.mintPriceU,
          mintedAt: new Date(),
          metadata: {
            source: "INTERNAL_MINT",
            tscAllocationFormula: "mintPriceU / tscInitialPriceUSDT",
          },
        },
      ],
      { session }
    );

    // 3. Credit initial TSC allocation.
    await creditTscAvailable({
      userId,
      amount: allocationAmount,
      type: "NFT_TSC_ALLOCATION",
      idempotencyKey:
        idempotencyKey ||
        `NFT_TSC_ALLOCATION:${createdNft._id.toString()}`,
      referenceId: createdNft._id.toString(),
      sourceNft: createdNft._id,
      metadata: {
        tierCode: tier.code,
        mintPriceU: mintPrice,
        tscInitialPriceUSDT: toNumber(protocolConfig.tscInitialPriceUSDT),
      },
      session,
    });

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "NFT minted successfully.",
      data: serializeUserNft(createdNft),
    });
  } catch (error) {
    if (session) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
    }

    console.error("Mint NFT error:", error);

    if (error.message === "INSUFFICIENT_INTERNAL_SOL_BALANCE") {
      return res.status(400).json({
        success: false,
        errorCode: "INSUFFICIENT_BALANCE",
        message: "Insufficient internal SOL balance to mint this NFT.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to mint NFT.",
      errorCode: error.message,
    });
  }
};

exports.getMyNfts = async (req, res) => {
  try {
    const { status, tierCode, page = 1, limit = 20 } = req.query;

    const query = { user: req.user._id };
    if (status) query.status = status;
    if (tierCode) query.tierCode = tierCode;

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      UserNft.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      UserNft.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: items.map(serializeUserNft),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Get my NFTs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch NFTs.",
    });
  }
};

exports.getMyNftById = async (req, res) => {
  try {
    const nft = await UserNft.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!nft) {
      return res.status(404).json({
        success: false,
        message: "NFT not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeUserNft(nft),
    });
  } catch (error) {
    console.error("Get NFT detail error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch NFT detail.",
    });
  }
};

exports.stakeMyNft = async (req, res) => {
  try {
    const nft = await UserNft.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!nft) {
      return res.status(404).json({
        success: false,
        message: "NFT not found.",
      });
    }

    if (nft.status === "BURNED") {
      return res.status(400).json({
        success: false,
        errorCode: "NFT_BURNED",
        message: "Burned NFT cannot be staked.",
      });
    }

    if (nft.status === "STAKED") {
      return res.status(200).json({
        success: true,
        message: "NFT is already staked.",
        data: serializeUserNft(nft),
      });
    }

    if (!["MINTED", "UNSTAKED"].includes(nft.status)) {
      return res.status(400).json({
        success: false,
        errorCode: "NFT_NOT_STAKEABLE",
        message: "This NFT cannot be staked.",
      });
    }

    const previousStatus = nft.status;

    nft.status = "STAKED";
    nft.stakedAt = new Date();
    nft.unstakedAt = null;

    await nft.save();

    try {
      const NftStakeEvent = require("../models/NftStakeEvent");
      await NftStakeEvent.create({
        user: req.user._id,
        userNft: nft._id,
        action: "STAKE",
        previousStatus,
        newStatus: nft.status,
      });
    } catch (eventError) {
      console.warn("Stake event log skipped:", eventError.message);
    }

    return res.status(200).json({
      success: true,
      message: "NFT staked successfully.",
      data: serializeUserNft(nft),
    });
  } catch (error) {
    console.error("Stake NFT error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to stake NFT.",
    });
  }
};

exports.unstakeMyNft = async (req, res) => {
  try {
    const nft = await UserNft.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!nft) {
      return res.status(404).json({
        success: false,
        message: "NFT not found.",
      });
    }

    if (nft.status !== "STAKED") {
      return res.status(400).json({
        success: false,
        errorCode: "NFT_NOT_STAKED",
        message: "Only staked NFTs can be unstaked.",
      });
    }

    const previousStatus = nft.status;

    nft.status = "UNSTAKED";
    nft.unstakedAt = new Date();

    await nft.save();

    try {
      const NftStakeEvent = require("../models/NftStakeEvent");
      await NftStakeEvent.create({
        user: req.user._id,
        userNft: nft._id,
        action: "UNSTAKE",
        previousStatus,
        newStatus: nft.status,
      });
    } catch (eventError) {
      console.warn("Unstake event log skipped:", eventError.message);
    }

    return res.status(200).json({
      success: true,
      message: "NFT unstaked successfully.",
      data: serializeUserNft(nft),
    });
  } catch (error) {
    console.error("Unstake NFT error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to unstake NFT.",
    });
  }
};

exports.getMyStakedNfts = async (req, res) => {
  try {
    const nfts = await UserNft.find({
      user: req.user._id,
      status: "STAKED",
    }).sort({ stakedAt: -1 });

    return res.status(200).json({
      success: true,
      data: nfts.map(serializeUserNft),
    });
  } catch (error) {
    console.error("Get staked NFTs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch staked NFTs.",
    });
  }
};

exports.purchaseMiningNft = async (req, res) => {
  const client = mongoose.connection.getClient();
  const topologyType = client?.topology?.description?.type;
  const useTransaction = topologyType === "ReplicaSetWithPrimary" || topologyType === "ReplicaSetNoPrimary" || topologyType === "Sharded";

  const session = useTransaction ? await mongoose.startSession() : null;
  if (session) {
    session.startTransaction();
  }

  try {
    const userId = req.user._id;
    const { tierCode, paymentAsset = "SOL", idempotencyKey } = req.body || {};

    if (!tierCode) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(400).json({
        success: false,
        message: "tierCode is required.",
      });
    }

    if (idempotencyKey) {
      const RewardTransaction = require("../models/RewardTransaction");
      const existingTx = await RewardTransaction.findOne({ idempotencyKey }).session(session);
      if (existingTx) {
        const existingNft = await UserNft.findById(existingTx.referenceId || existingTx.sourceNft).session(session);
        if (existingNft) {
          if (session) {
            await session.abortTransaction();
            session.endSession();
          }
          return res.status(200).json({
            success: true,
            message: "NFT already purchased (idempotent).",
            data: serializeUserNft(existingNft),
          });
        }
      }
    }

    const tier = await NftTier.findOne({ code: tierCode, isActive: true }).session(session);

    if (!tier) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        message: "NFT tier not found or inactive.",
      });
    }

    const protocolConfig = await ProtocolConfig.findOne({ key: "default" }).session(session);

    if (!protocolConfig) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(500).json({
        success: false,
        message: "Protocol config missing. Please seed config first.",
      });
    }

    // Fetch live SOL price from CoinGecko
    let solUsdRate = 150; // fallback
    try {
      const axios = require('axios');
      const rateRes = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
        { timeout: 5000 }
      );
      const rate = rateRes.data?.solana?.usd;
      if (rate && rate > 0) solUsdRate = rate;
    } catch (rateErr) {
      console.warn('[purchaseMiningNft] Could not fetch live SOL rate, using fallback:', solUsdRate);
    }

    const mintPriceUsdt = toNumber(tier.mintPriceU);
    const requiredSol = parseFloat((mintPriceUsdt / solUsdRate).toFixed(9));
    const allocationAmount = calculateTscAllocation({ tier, protocolConfig });

    // 1. Debit internal SOL wallet
    try {
      await debitInternalSolWallet({
        userId,
        amountSol: requiredSol,
        session,
      });
    } catch (debitErr) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      if (debitErr.message === "INSUFFICIENT_INTERNAL_SOL_BALANCE") {
        return res.status(402).json({
          success: false,
          errorCode: "INSUFFICIENT_BALANCE",
          message: `Insufficient wallet balance. You need ${requiredSol} SOL (≈ $${mintPriceUsdt} USDT at current rate of $${solUsdRate}/SOL).`,
          requiredSol,
          solUsdRate,
        });
      }
      throw debitErr;
    }

    // 2. Generate serial number and create NFT (status: STAKED!)
    const currentMultiplier = protocolConfig.isTscLaunched
      ? tier.poolMultiplierAfterTsc
      : tier.poolMultiplierBeforeTsc;

    const serialNo = await generateNftSerialNo(tier.code, session);

    const [createdNft] = await UserNft.create(
      [
        {
          user: userId,
          tierCode: tier.code,
          tierName: tier.name,
          serialNo,
          mintPriceU: tier.mintPriceU,
          miningPower: tier.miningPower,
          powerCoefficient: tier.powerCoefficient,
          poolMultiplierBeforeTsc: tier.poolMultiplierBeforeTsc,
          poolMultiplierAfterTsc: tier.poolMultiplierAfterTsc,
          currentPoolMultiplier: currentMultiplier,
          dailyYieldRatePercent: tier.dailyYieldRatePercent,
          tscAllocationAmount: toDecimal128(allocationAmount),
          status: "STAKED", // Auto-staked!
          paymentAsset,
          paymentAmount: toDecimal128(requiredSol),
          mintedAt: new Date(),
          stakedAt: new Date(),
          metadata: {
            source: "INTERNAL_PURCHASE",
            tscAllocationFormula: "mintPriceU / tscInitialPriceUSDT",
            solUsdRate,
          },
        },
      ],
      { session }
    );

    // 3. Credit initial TSC allocation
    await creditTscAvailable({
      userId,
      amount: allocationAmount,
      type: "NFT_TSC_ALLOCATION",
      idempotencyKey:
        idempotencyKey ||
        `NFT_TSC_ALLOCATION:${createdNft._id.toString()}`,
      referenceId: createdNft._id.toString(),
      sourceNft: createdNft._id,
      metadata: {
        tierCode: tier.code,
        mintPriceU: mintPriceUsdt,
        tscInitialPriceUSDT: toNumber(protocolConfig.tscInitialPriceUSDT),
      },
      session,
    });

    // 4. Create LedgerRow history entry
    const { createLedgerEntry } = require("../jobs/helpers/ledgerHelpers");
    const narrative = `Purchased Mining NFT ${tier.code} — Power: ${toNumber(tier.miningPower)}, Coefficient: ${toNumber(tier.powerCoefficient)}×. Paid ${requiredSol} SOL @ $${solUsdRate}/SOL.`;
    await createLedgerEntry({
      userId,
      eventType: "NFT_PURCHASE",
      amount: requiredSol,
      walletFrom: "SOL_INTERNAL",
      walletTo: "NFT_MINT",
      tscAmount: allocationAmount,
      narrative,
      refId: createdNft._id.toString(),
    }, session);

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Mining NFT purchased and staked successfully.",
      data: serializeUserNft(createdNft),
    });

  } catch (error) {
    if (session) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
    }

    console.error("Purchase Mining NFT error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to purchase Mining NFT.",
      errorCode: error.message,
    });
  }
};
