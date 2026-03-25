const mongoose = require("mongoose");

const WithdrawalDepositAdjustmentSchema = new mongoose.Schema(
    {
        negativeWithdrawal: {
            type: Number,
            default: 0,
            min: 0, // always store absolute value
        },
        positiveDeposit: {
            type: Number,
            default: 0,
            min: 0,
        },

        // optional but highly recommended
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: false,
        },

        note: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model(
    "Settings",
    WithdrawalDepositAdjustmentSchema
);
