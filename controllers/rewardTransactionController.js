const RewardTransaction = require("../models/RewardTransaction");

const formatDecimal = (value) => value?.toString?.() || "0";

exports.getMyRewardTransactions = async (req, res) => {
  try {
    const {
      asset,
      type,
      direction,
      page = 1,
      limit = 20,
    } = req.query;

    const query = {
      user: req.user._id,
    };

    if (asset) query.asset = asset;
    if (type) query.type = type;
    if (direction) query.direction = direction;

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      RewardTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      RewardTransaction.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: items.map((item) => ({
        ...item,
        amount: formatDecimal(item.amount),
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Get reward transactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch reward transactions.",
    });
  }
};
