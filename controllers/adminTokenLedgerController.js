const { postTokenTransaction } = require("../services/internalTokenLedgerService");

exports.adjustTokenBalance = async (req, res) => {
  try {
    const {
      userId,
      asset,
      balanceField,
      direction,
      amount,
      reason,
    } = req.body;

    if (!userId || !asset || !balanceField || !direction || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters.",
      });
    }

    const createdBy = req.user ? req.user._id : null;
    const timestamp = Date.now();
    const idempotencyKey = `ADMIN:${userId}:${asset}:${balanceField}:${timestamp}`;

    const result = await postTokenTransaction({
      userId,
      asset,
      balanceField,
      direction,
      type: "ADMIN_ADJUSTMENT",
      amount,
      idempotencyKey,
      createdBy,
      metadata: { reason: reason || "Admin manual adjustment" },
    });

    return res.status(200).json({
      success: true,
      message: "Balance adjusted successfully.",
      data: {
        alreadyPosted: result.alreadyPosted,
        transaction: {
          ...result.transaction.toJSON(),
          amount: result.transaction.amount.toString(),
        },
        wallets: result.ledger.wallets,
      },
    });
  } catch (error) {
    console.error("Admin token adjustment error:", error);
    return res.status(500).json({
      success: false,
      message: "Adjustment failed.",
      error: error.message,
    });
  }
};
