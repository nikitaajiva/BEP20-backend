require('dotenv').config();
const Ledger = require("../models/Ledger");
const LedgerRow = require("../models/LedgerRow");
const { sendUsdt } = require("../utils/usdtTransactions");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Decimal = mongoose.Types.Decimal128;
const User = require("../models/User");
const {
  getOrCreateLedger,
  createLedgerEntry,
} = require("../jobs/helpers/ledgerHelpers");
const {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  minDecimal128,
  maxDecimal128,
  compareDecimal128,
  roundTo6Decimal128,
} = require("../utils/decimal128Utils");
const { decreaseUplineTeamLp } = require("../services/lpService");
const WithdrawalErrorLog = require("../models/WithdrawalErrorLog");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const EcosystemFee = require("../models/EcosystemFee");
const EventRewardCredit = require("../models/EventRewardCredit");

const { sendTransactionSuccessEmail } = require("../controllers/authController");


const { Decimal128 } = mongoose.Types;
/* Get Onchain deposits and Withdrawals Starts Here */
const getUserChainTotals = async (userId) => {
  const baseFilter = { userId };

  const [depositSummary] = await ChainDeposit.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  const [withdrawalSummary] = await ChainWithdrawal.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  return {
    totalDeposits: depositSummary?.totalAmount || 0,
    totalWithdrawals: withdrawalSummary?.totalAmount || 0,
  };
};
/* Get Onchain deposits and Withdrawals Ends Here*/

/* Get Total Economy fees paide by user */
const getTotalEcosystemFeeByUser = async (userId) => {
  try {
    const result = await EcosystemFee.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId)
        }
      },
      {
        $group: {
          _id: "$userId",
          totalFee: { $sum: "$amount" }
        }
      }
    ]);

    const total = result[0]?.totalFee || mongoose.Types.Decimal128.fromString("0.0");
    return total;
  } catch (error) {
    console.error("❌ Error fetching ecosystem fee:", error);
    throw error;
  }
};
/* Get Total Economy fees paide by user Ends Here */

const distributeNodeFeeAirdrop = async (withdrawalAmount, triggeringUserId, triggeringWithdrawalId = null) => {
  try {
    const amountVal = parseFloat(withdrawalAmount.toString());
    if (amountVal <= 0) return;

    const totalAirdrop = amountVal * 0.02; // 2% fee airdrop

    const TIER_SHARES = {
      P1: 0.20,
      P2: 0.15,
      P3: 0.125,
      P4: 0.115,
      P5: 0.105,
      P6: 0.095,
      P7: 0.085,
      P8: 0.075,
      P9: 0.05
    };

    const NodeReward = require("../models/NodeReward");

    // Loop through each tier to share the fee among qualified node operators
    for (const [tier, sharePct] of Object.entries(TIER_SHARES)) {
      const qualifiedUsers = await User.find({ nodeTier: tier });
      if (qualifiedUsers.length === 0) continue;

      const tierPool = totalAirdrop * sharePct;
      const sharePerUser = tierPool / qualifiedUsers.length;

      for (const qUser of qualifiedUsers) {
        // Create NodeReward entry with full traceability fields
        await NodeReward.create({
          userId: qUser._id,
          nodeTier: tier,
          amount: mongoose.Types.Decimal128.fromString(sharePerUser.toFixed(6)),
          rewardType: "fee_airdrop",
          narrative: `${tier} Node Airdrop: ${(sharePct * 100).toFixed(1)}% pool share of 2% withdrawal fee from network activity.`,
          withdrawalAmount: mongoose.Types.Decimal128.fromString(amountVal.toFixed(6)),
          tierSharePct: sharePct,
          triggeringWithdrawalId: triggeringWithdrawalId || null
        });

        // Credit to the user's community rewards wallet in Ledger
        await Ledger.updateOne(
          { userId: qUser._id },
          { 
            $inc: { 
              "wallets.communityRewards": mongoose.Types.Decimal128.fromString(sharePerUser.toFixed(6)) 
            } 
          }
        );
      }
    }
    console.log(`[Node Fee Airdrop] Distributed 2% withdrawal fee (${totalAirdrop.toFixed(6)} USDT) to active node operators.`);
  } catch (error) {
    console.error("❌ Error distributing node fee airdrop:", error);
  }
};


const withdrawUSDT = async (req, res) => {
  try {
    const { amount, walletFrom = "LP", uniqueTransactionId } = req.body;
   const userId = req.user._id;




   const useripAddress = req.userip;
    let ecosystemFee = false;
    let ecosystemFeeDeduction = Decimal128.fromString("0.0");

    let user;
    user = await User.findById(userId);

    let ledgerRow; // Track INITIATED row for status updates
    let zeroRiskledgerEntry = null;
    if (!uniqueTransactionId) {
      throw new Error("Updates in progress.. please wait for a few minutes");
    }

    console.log(
      `[Withdrawal Entry] User: ${userId} initiated withdrawal. Request Body:`,
      req.body
    );
    console.log(
      `[Withdrawal Entry] Unique Transaction ID: ${uniqueTransactionId}`
    );

    // First, check if this transaction has already been processed
    // Check both uniqueTransactionId and transactionId for backward compatibility
    const existingLedgerRow = await LedgerRow.findOne({
      userId,
      $or: [
        { uniqueTransactionId },
        { transactionId: uniqueTransactionId }, // Check old field for backward compatibility
      ],
      eventType: { $in: ["WITHDRAWAL", "REWARDS_REDEEMED"] },
    });

    if (existingLedgerRow) {
      return res.status(200).json({
        success: true,
        message: "Transaction already processed",
        isDuplicate: true,
        transactionHash: existingLedgerRow.refId, // This would be the chain transaction hash
      });
    }

    // Check if user was found in early call, if not fetch again
    if (!user) {
      user = await User.findById(userId);
    }
    if (!user || !user.wallet_address) {
      throw new Error(
        "No destination wallet address is configured for your account. Please update your profile."
      );
    }
    const destinationAddress = user.wallet_address;

    if (!amount || amount <= 0) {
      throw new Error("Invalid withdrawal amount");
    }

    let amountD128 = Decimal.fromString(amount.toString());
    let amountWithdraw = amountD128;

    if (!ethers.isAddress(destinationAddress)) {
      console.error(
        `Invalid BEP20 address found in user profile for userId: ${userId}`
      );
      throw new Error(
        "Your configured BEP20 address is invalid. Please contact support."
      );
    }

    if (!["LP", "COMMUNITY_REWARDS", "ZERO_RISK"].includes(walletFrom)) {
      throw new Error("Invalid withdrawal source wallet.");
    }

    // Get user's ledger
    const ledger = await Ledger.findOne({ userId });
    if (!ledger) {
      throw new Error("User Ledger not found");
    }
    // ⛔ HARD STOP: If withdrawals are disabled, do NOTHING
if (ledger.withdrawalDisabled === true) {
  return res.status(423).json({
    success: false,
    disableWithdrawal: true,
    message: "A withdrawal is already being processed. Please wait a few minutes.",
  });
}

   // 🔒 ATOMIC GLOBAL LOCK — Blocks all duplicate withdrawals
const locked = await Ledger.findOneAndUpdate(
  {
    userId,
    withdrawalDisabled: { $ne: true } // only lock if not already locked
  },
  {
    $set: { withdrawalDisabled: true }
  },
  { new: true }
);

if (!locked) {
  return res.status(429).json({
    success: false,
    message: "A withdrawal is already being processed. Please wait a few minutes.",
    disableWithdrawal: true
  });
}

    // if ledger.wallets.zeroRisk is less than the amount, throw an error
    if (
      walletFrom !== "COMMUNITY_REWARDS" &&
      compareDecimal128(ledger.wallets.zeroRisk || "0.0", amountD128) < 0
    ) {
      throw new Error("Insufficient balance in Zero Risk wallet. ");
    }
    if (!ledger) {
      throw new Error("Ledger not found");
    }

    // ------------------------------------------------------------
    // If a previous withdrawal is still pending reconciliation,
    // block new requests immediately.
    // ------------------------------------------------------------

    // Check for pending withdrawal
    if (
      ledger.pendingWithdrawal &&
      typeof ledger.pendingWithdrawal === "object" &&
      !Array.isArray(ledger.pendingWithdrawal) &&
      ledger.pendingWithdrawal.timestamp &&
      ledger.pendingWithdrawal.amount &&
      typeof ledger.pendingWithdrawal.amount.equals === "function" &&
      !ledger.pendingWithdrawal.amount.equals(Decimal128.fromString("0"))
    ) {
      const pendingAge =
        Date.now() - new Date(ledger.pendingWithdrawal.timestamp).getTime();

      if (pendingAge < 2 * 60 * 1000) {
        throw new Error(
          "Another withdrawal is in progress. Please wait a few minutes and try again."
        );
      }
    }

    // Ensure all limits are initialized to prevent errors on older documents
    if (!ledger.limits) ledger.limits = {};
    if (!ledger.limits.swiftLimit)
      ledger.limits.swiftLimit = {
        cap: Decimal.fromString("0.0"),
        used: Decimal.fromString("0.0"),
      };
    if (!ledger.limits.boostLimit)
      ledger.limits.boostLimit = {
        cap: Decimal.fromString("0.0"),
        used: Decimal.fromString("0.0"),
      };
    if (!ledger.limits.zeroRiskLimit)
      ledger.limits.zeroRiskLimit = {
        cap: Decimal.fromString("0.0"),
        used: Decimal.fromString("0.0"),
      };
    if (!ledger.limits.fiveXLimit)
      ledger.limits.fiveXLimit = {
        cap: Decimal.fromString("0.0"),
        used: Decimal.fromString("0.0"),
      };
    if (!ledger.totalRewardsWithdrawal)
      ledger.totalRewardsWithdrawal = Decimal.fromString("0.0");

    // ------------------------------------------------------------------
    // Guard against sub-drop “dust” withdrawals ( < 0.000001 USDT )
    // ------------------------------------------------------------------
    if (compareDecimal128(amountD128, Decimal.fromString("0.000001")) < 0) {
      throw new Error("Withdrawal amount too small. Minimum is 0.000001 USDT.");
    }

    // --- REVISED WITHDRAWAL VALIDATION LOGIC ---

    if (walletFrom === "ZERO_RISK") {
      const usdtBalance = ledger.wallets.bnb || Decimal.fromString("0.0");
      const lpBalance = ledger.wallets.lp || Decimal.fromString("0.0");
      const rewardsBalance =
        ledger.wallets.communityRewards || Decimal.fromString("0.0");
      const zeroRiskCap = ledger.wallets.zeroRisk || Decimal.fromString("0.0");
      const totalRewardsWithdrawal =
        ledger.totalRewardsWithdrawal || Decimal.fromString("0.0");

      // This is the pool of funds that back the zero risk guarantee
      const principalAndStaging = addDecimal128(usdtBalance, lpBalance);

      // Per the new rule, the accessible principal is reduced by any available rewards
      const accessiblePrincipal = subtractDecimal128(
        principalAndStaging,
        rewardsBalance
      );

      // The max withdrawable is the lesser of the original principal limit (zeroRiskCap)
      // and the newly calculated accessible principal.
      //  const effectiveLimit = minDecimal128(zeroRiskCap, accessiblePrincipal);

      // This is then further reduced by any rewards that have already been withdrawn.
      //  const limitAfterPreviousWithdrawals = subtractDecimal128(effectiveLimit, totalRewardsWithdrawal);

      // The max withdrawable is the lesser of the original principal limit (zeroRiskCap)
      // and the newly calculated accessible principal.
      const effectiveLimit = zeroRiskCap;

      // This is then further reduced by any rewards that have already been withdrawn.
      const limitAfterPreviousWithdrawals = effectiveLimit;
      // The final amount cannot be negative.
      const maxWithdrawableZeroRisk = maxDecimal128(
        "0.0",
        limitAfterPreviousWithdrawals
      );

      if (compareDecimal128(amountD128, maxWithdrawableZeroRisk) > 0) {
        // amount > maxWithdrawable
        // instead of throwing an error, return a message that the withdrawal is not possible
        return res.status(400).json({
          success: false,
          message:
            "Withdrawal amount exceeds your Zero Risk balance. Maximum available: " +
            maxWithdrawableZeroRisk.toString() +
            " USDT.",
        });
      }
    } else if (walletFrom === "LP") {
      const currentBalance = ledger.wallets.lp || Decimal.fromString("0.0");

      if (compareDecimal128(amountD128, currentBalance) > 0) {
        // currentBalance < amount
        throw new Error(
          `Insufficient balance in LP wallet. Available: ${currentBalance.toString()}, Tried: ${amount}`
        );
      }

      // Apply additional earning-based 5X limits for these wallets
      const zeroRiskLimit =
        ledger.wallets.zeroRisk || Decimal.fromString("0.0");
      const fiveXUsed =
        ledger.limits.fiveXLimit?.used || Decimal.fromString("0.0");
      const fiveXCap =
        ledger.limits.fiveXLimit?.cap || Decimal.fromString("0.0");
      const fiveXRemaining = subtractDecimal128(fiveXCap, fiveXUsed);

      // User can withdraw up to their remaining zero-risk deposit amount, but not more than their remaining 5x earning potential.
      const maxWithdrawable = minDecimal128(zeroRiskLimit, fiveXRemaining);

      if (compareDecimal128(amountD128, maxWithdrawable) > 0) {
        // amount > maxWithdrawable
        throw new Error(
          `Withdrawal amount of ${amount.toString()} USDT exceeds your current earning-based limit. Maximum withdrawable: ${maxWithdrawable.toString()} USDT`
        );
      }
    } else if (walletFrom === "COMMUNITY_REWARDS") {
      const currentBalance =
        ledger.wallets.communityRewards || Decimal.fromString("0.0");
      if (compareDecimal128(amountD128, currentBalance) > 0) {
        // currentBalance < amount
        throw new Error(
          `Insufficient balance in COMMUNITY_REWARDS wallet. Available: ${currentBalance.toString()}, Tried: ${amount}`
        );
      }
      // No other validation needed for a simple rewards withdrawal
    }
    // ------------------------------------------------------------------
    // Insert INITIATED ledger row (exact-once guard)
    // ------------------------------------------------------------------
    try {
      ledgerRow = new LedgerRow({
        userId,
        eventType:
          walletFrom === "COMMUNITY_REWARDS"
            ? "REWARDS_REDEEMED"
            : "WITHDRAWAL",
        walletFrom,
        walletTo: "EXTERNAL",
        amount: amountD128,
        uniqueTransactionId,
        status: "INITIATED",
        userip:useripAddress,
        narrative: `Withdrawal initiated to ${destinationAddress}`,
      });
      await ledgerRow.save();
    } catch (dupErr) {
      if (dupErr.code === 11000) {
        const existing = await LedgerRow.findOne({ uniqueTransactionId });
        return res.status(200).json({
          success: true,
          message: "Transaction already processed",
          isDuplicate: true,
          transactionHash: existing?.refId,
          status: existing?.status,
        });
      }
      throw dupErr;
    }

    let newBalance; // will hold post-deduction balance for response
    // Prepare container for pendingWithdrawal so we can populate it per-branch
    let pendingData = {};
    try {
      // ------------------------------------------------------------
      // 1) Immediately deduct the amount from the relevant wallets
      // ------------------------------------------------------------
      console.log(
        `[Withdrawal Apply] About to process withdrawal logic for walletFrom: '${walletFrom}' BEFORE chain submission`
      );

      if (walletFrom === "ZERO_RISK") {
        const amountFromUsdt = minDecimal128(
          amountD128,
          ledger.wallets.bnb || Decimal.fromString("0.0")
        );
        const amountFromLp = subtractDecimal128(amountD128, amountFromUsdt);

        ledger.wallets.bnb = subtractDecimal128(
          ledger.wallets.bnb || "0.0",
          amountFromUsdt
        );

        // Reduce Zero-Risk principal by the full withdrawal amount
        ledger.wallets.zeroRisk = subtractDecimal128(
          ledger.wallets.zeroRisk || "0.0",
          amountD128
        );
        if (compareDecimal128(ledger.wallets.zeroRisk, "0.0") < 0) {
          ledger.wallets.zeroRisk = Decimal.fromString("0.0");
        }

        if (compareDecimal128(amountFromLp, "0.0") > 0) {
          ledger.wallets.lp = subtractDecimal128(
            ledger.wallets.lp || "0.0",
            amountFromLp
          );

  // Get totals
  const { totalDeposits, totalWithdrawals } = await getUserChainTotals(userId);
  const projectedWithdrawals = addDecimal128(totalWithdrawals, amountD128);

  

          // ✅ If deposits > projected withdrawals, also debit from Community Rewards
          if (compareDecimal128(totalDeposits, projectedWithdrawals) > 0) {
            let availableCR = ledger.wallets.communityRewards || Decimal128.fromString("0.0");

            // Take min(amount, availableCR)
            const debitFromCR = compareDecimal128(availableCR, amountD128) >= 0
              ? amountD128
              : availableCR;

            if (compareDecimal128(debitFromCR, "0.0") > 0) {
              ledger.wallets.communityRewards = subtractDecimal128(availableCR, debitFromCR);

              // Create linked LedgerRow for CR debit
              await LedgerRow.create({
                userId,
                eventType: "AUTO_DEBIT",
                walletFrom: "COMMUNITY_REWARDS",
                walletTo: "ZERO_RISK",
                amount: debitFromCR,
                refId: ledgerRow._id.toString(),   // link to main withdrawal
                narrative: `Auto-debited Community Rewards (${debitFromCR.toString()}) for ZERO_RISK withdrawal`,
                status: "COMPLETED",
              });
            // ✅ Only add the portion that actually came from CR
            ledger.totalRewardsWithdrawal = addDecimal128(
              ledger.totalRewardsWithdrawal || Decimal128.fromString("0.0"),
              debitFromCR
            );

              
            }
          }
                  // ** DECREASE UPLINE TEAM LP **
          decreaseUplineTeamLp(user.uhid, amountFromLp).catch((err) => {
            console.error(
              `[BACKGROUND_ERROR] Failed to decrease team LP for user ${user.uhid} on withdrawal:`,
              err
            );
          });



          // Also reduce airdrop wallet balance when LP is touched
          ledger.wallets.airdrop = subtractDecimal128(
            ledger.wallets.airdrop || "0.0",
            amountFromLp
          );
          if (compareDecimal128(ledger.wallets.airdrop, "0.0") < 0)
            ledger.wallets.airdrop = Decimal.fromString("0.0");

          // If withdrawal touches LP wallet, reset limits to new LP balance (boost/airdrop)
          ledger.limits.boostLimit.cap = ledger.wallets.lp;
          ledger.limits.airdropLimit.cap = ledger.wallets.lp;

          // --- Sponsor Boost Wallet Reduction Logic ---
          if (user.sponsorId) {
            try {
              const reductionAmount = multiplyDecimal128(amountFromLp, "0.5");
              const amountToDecrement = Decimal128.fromString(
                (parseFloat(reductionAmount.toString()) * -1).toString()
              );

              // ✅ Atomic update to prevent race conditions
              await Ledger.updateOne(
                { userId: user.sponsorId },
                { $inc: { "wallets.boost": amountToDecrement } }
              );

              console.log(
                `[Sponsor Update] Successfully queued atomic reduction for sponsor ${
                  user.sponsorId
                }'s boost wallet by ${reductionAmount.toString()} (based on LP withdrawal of ${amountFromLp.toString()}).`
              );
            } catch (e) {
              console.error(
                `[Sponsor Update] CRITICAL ERROR: Failed to atomically update sponsor's boost wallet for sponsor ${user.sponsorId}. Error:`,
                e
              );
            }
          }
        }

        // ---------------- Store pendingWithdrawal breakdown (ZERO_RISK) ----------------
        const sponsorBoostReduction = user.sponsorId
          ? multiplyDecimal128(amountFromLp, "0.5")
          : Decimal.fromString("0.0");
        pendingData = {
          idempotencyKey: uniqueTransactionId,
          uniqueTransactionId,
          walletFrom,
          timestamp: new Date(),
          amountFromUsdt: parseFloat(amountFromUsdt.toString()),
          amountFromLp: parseFloat(amountFromLp.toString()),
          amountFromRewards: 0,
          zeroRisk: parseFloat(amountD128.toString()),
          airdrop: parseFloat(amountFromLp.toString()),
          sponsorBoost: parseFloat(sponsorBoostReduction.toString()),
        };

        newBalance = addDecimal128(ledger.wallets.bnb, ledger.wallets.lp);
      } else if (walletFrom === "LP") {
        // -------------------------------------------------------------
        // Pure LP withdrawal (used when USDT balance is insufficient)
        // -------------------------------------------------------------
        ledger.wallets.lp = subtractDecimal128(
          ledger.wallets.lp || "0.0",
          amountD128
        );

        // Reduce Zero-Risk principal accordingly
        ledger.wallets.zeroRisk = subtractDecimal128(
          ledger.wallets.zeroRisk || "0.0",
          amountD128
        );
        if (compareDecimal128(ledger.wallets.zeroRisk, "0.0") < 0) {
          ledger.wallets.zeroRisk = Decimal.fromString("0.0");
        }

        // Decrease team LP for the upline
        decreaseUplineTeamLp(user.uhid, amountD128).catch((err) => {
          console.error(
            `[BACKGROUND_ERROR] Failed to decrease team LP for user ${user.uhid} on withdrawal:`,
            err
          );
        });

        // Reduce airdrop wallet by the same amount
        ledger.wallets.airdrop = subtractDecimal128(
          ledger.wallets.airdrop || "0.0",
          amountD128
        );
        if (compareDecimal128(ledger.wallets.airdrop, "0.0") < 0) {
          ledger.wallets.airdrop = Decimal.fromString("0.0");
        }

        // Reset limits that track LP balance
        ledger.limits.boostLimit.cap = ledger.wallets.lp;
        // zeroRiskLimit.cap no longer tracked
        ledger.limits.airdropLimit.cap = ledger.wallets.lp;

        // --- Sponsor Boost Wallet Reduction Logic (copy of ZERO_RISK) ---
        if (user.sponsorId) {
          try {
            const reductionAmount = multiplyDecimal128(amountD128, "0.5");
            const amountToDecrement = Decimal128.fromString(
              (parseFloat(reductionAmount.toString()) * -1).toString()
            );

            // ✅ Atomic update to prevent race conditions
            await Ledger.updateOne(
              { userId: user.sponsorId },
              { $inc: { "wallets.boost": amountToDecrement } }
            );

            console.log(
              `[Sponsor Update] Successfully queued atomic reduction for sponsor ${
                user.sponsorId
              }'s boost wallet by ${reductionAmount.toString()} (based on LP withdrawal).`
            );
          } catch (e) {
            console.error(
              `[Sponsor Update] CRITICAL ERROR: Failed to atomically update sponsor's boost wallet for sponsor ${user.sponsorId}. Error:`,
              e
            );
          }
        }

        // Clamp LP to zero if it went negative due to rounding
        if (compareDecimal128(ledger.wallets.lp, "0.0") < 0) {
          ledger.wallets.lp = Decimal.fromString("0.0");
        }

        // ---------------- Store pendingWithdrawal breakdown (LP) ----------------
        const sponsorBoostReductionLP = user.sponsorId
          ? multiplyDecimal128(amountD128, "0.5")
          : Decimal.fromString("0.0");
        pendingData = {
          idempotencyKey: uniqueTransactionId,
          uniqueTransactionId,
          walletFrom,
          timestamp: new Date(),
          amountFromUsdt: 0,
          amountFromLp: parseFloat(amountD128.toString()),
          amountFromRewards: 0,
          zeroRisk: parseFloat(amountD128.toString()),
          airdrop: parseFloat(amountD128.toString()),
          sponsorBoost: parseFloat(sponsorBoostReductionLP.toString()),
        };

        newBalance = ledger.wallets.lp;
      } else if (walletFrom === "COMMUNITY_REWARDS") {
        ledger.wallets.communityRewards = subtractDecimal128(
          ledger.wallets.communityRewards || "0.0",
          amountD128
        );
        ledger.totalRewardsWithdrawal = addDecimal128(
          ledger.totalRewardsWithdrawal || "0.0",
          amountD128
        );

          // --- Ecosystem Fee Calculation ---
        const { totalDeposits, totalWithdrawals } = await getUserChainTotals(userId);
        console.log(
            "🌿 Ecosystem Fee Check:",
            "\n - totalDeposits:", totalDeposits.toString(),
            "\n - totalWithdrawals:", totalWithdrawals.toString());
        const EcofeePaidbyUser = await getTotalEcosystemFeeByUser(userId);
        const alreadyPaid = EcofeePaidbyUser || Decimal128.fromString("0.0");

        const projectedWithdrawals = addDecimal128(totalWithdrawals, amountD128);

        // ✅ Only trigger if withdrawals exceed deposits
        if (compareDecimal128(projectedWithdrawals, totalDeposits) === 1) {
        ecosystemFee = true;

            const excessAmount = subtractDecimal128(projectedWithdrawals, totalDeposits);
            let rawFee = multiplyDecimal128(excessAmount, "0.10");
             ecosystemFeeDeduction = subtractDecimal128(rawFee, alreadyPaid);

            if (compareDecimal128(ecosystemFeeDeduction, "0.0") < 0)
              ecosystemFeeDeduction = Decimal128.fromString("0.0");

            // If withdrawal is smaller than fee → take full withdrawal as fee
            let adjustedAmount = subtractDecimal128(amountD128, ecosystemFeeDeduction);
              if (compareDecimal128(adjustedAmount, "0.0") < 0) {
                console.warn(
                  `🌿 Fee (${ecosystemFeeDeduction.toString()}) > withdrawal (${amountD128.toString()}), charging full withdrawal.`
                );
                ecosystemFeeDeduction = Decimal128.fromString(amountD128.toString());   
                      // user pays full
                amountD128 = Decimal128.fromString("0.0");   // nothing transferred
              } else {
                amountD128 = roundTo6Decimal128(adjustedAmount);
                ecosystemFeeDeduction = roundTo6Decimal128(ecosystemFeeDeduction);
              }

              


                console.log(
                  "🌿 Ecosystem Fee Check:",
                  "\n - totalDeposits:", totalDeposits.toString(),
                  "\n - totalWithdrawals:", totalWithdrawals.toString(),
                  "\n - projectedWithdrawals:", projectedWithdrawals.toString(),
                  "\n - alreadyPaid:", alreadyPaid.toString(),
                  "\n - rawFee:", rawFee.toString(),
                  "\n - finalDeduction:", ecosystemFeeDeduction,
                  "\n - finalTransfer:", amountD128.toString()
                );
        } else {
        
        }


        // Also reduce Zero-Risk principal (rewards withdrawal still returns principal)
        // ledger.wallets.zeroRisk = subtractDecimal128(
        //   ledger.wallets.zeroRisk || "0.0",
        //   amountD128
        // );
        let remainingAmountD128 = amountD128; // start with full amount
        let deductedFromZeroRisk = Decimal.fromString("0.0");
        if (compareDecimal128(ledger.wallets.zeroRisk, "0.0") < 0) {
          ledger.wallets.zeroRisk = Decimal.fromString("0.0");
        }
        // Step 1: Deduct from ZERO_RISK if > 0
        /* deduct from ZERO_RISK if its available */
        const zeroRiskcurrentBalance =
          ledger.wallets.zeroRisk || Decimal.fromString("0.0");
        // Only proceed if balance is greater than 0.0
        if (
          compareDecimal128(zeroRiskcurrentBalance, Decimal.fromString("0.0")) >
          0
        ) {
          // Calculate how much to deduct: either the full requested amount or whatever is available
          deductedFromZeroRisk = minDecimal128(
            zeroRiskcurrentBalance,
            amountD128
          );
          // Subtract the deductedFromZeroRisk  from the wallet balance and store the updated Decimal128 value
          ledger.wallets.zeroRisk = subtractDecimal128(
            ledger.wallets.zeroRisk || "0.0",
            deductedFromZeroRisk
          );
          remainingAmountD128 = subtractDecimal128(
            amountD128,
            deductedFromZeroRisk
          );
        }
        // Step 2: Apply 10% extra deduction on the remaining amount
        const extraDeduction = multiplyDecimal128(remainingAmountD128, "0.1");
        //
        //  amountWithdraw = subtractDecimal128(amountD128, extraDeduction);
        newBalance = ledger.wallets.communityRewards;

        // ---------------- Store pendingWithdrawal breakdown (COMMUNITY_REWARDS) ----------------
        pendingData = {
          idempotencyKey: uniqueTransactionId,
          uniqueTransactionId,
          walletFrom,
          timestamp: new Date(),
          amountFromUsdt: 0,
          amountFromLp: 0,
          amountFromRewards: parseFloat(amountD128.toString()),
          zeroRisk: parseFloat(amountD128.toString()),
          airdrop: 0,
          sponsorBoost: 0,
        };
      }

      // Recalculate 5x limit cap for ALL withdrawals based *only* on the current LP wallet balance
      const lpBalanceFor5x = ledger.wallets.lp || Decimal.fromString("0.0");
      ledger.limits.fiveXLimit.cap = multiplyDecimal128(lpBalanceFor5x, "5.0");

      // Clamp usdt & lp negatives (precision-safety)
      if (compareDecimal128(ledger.wallets.bnb, "0.0") < 0) {
        ledger.wallets.bnb = Decimal.fromString("0.0");
      }
      if (compareDecimal128(ledger.wallets.lp, "0.0") < 0) {
        ledger.wallets.lp = Decimal.fromString("0.0");
      }

      // ---------------- Commit pendingWithdrawal + disable further withdrawals ----------------
      ledger.pendingWithdrawal = pendingData;
      ledger.withdrawalDisabled = true;

      // Persist the deduction BEFORE attempting chain payment
      await ledger.save();

// ------------------------------------------------------------
// 🌿 (NEW) Pre-create Ecosystem Fee entry BEFORE chain send
// ------------------------------------------------------------
let EcosystemFeeEntry = null;


// Only proceed if fee is applicable and > 0
if (ecosystemFee === true && compareDecimal128(ecosystemFeeDeduction, "0.0") > 0) {
  try {
    EcosystemFeeEntry = await EcosystemFee.create({
      userId,
      amount: Decimal128.fromString(ecosystemFeeDeduction.toString()),
      walletFrom: "COMMUNITY_REWARDS",
      ledgerRefId: ledgerRow._id.toString(),
      narrative: "10% ecosystem fee charged during Rewards Redeem",
      status: "INITIATED",
      createdAt: new Date(),
    });
    
  } catch (ecoCreateErr) {
    console.error("⚠️ Failed to pre-create Ecosystem Fee entry:", ecoCreateErr);
  }
} else {
  
}

// ------------------------------------------------------------
// 2) Submit payment on BSC (main withdrawal)
// ------------------------------------------------------------
const fixedAmount = Number(parseFloat(amountD128).toFixed(6));
let chainTxHash = null;

try {
    // 🌿 CASE: ecosystem fee consumed the full amount
    if (compareDecimal128(amountD128, "0.0") <= 0) {
        console.warn(
          `🌿 Withdrawal amount (${amountD128.toString()}) is zero after ecosystem fee. Skipping chain send.`
        );
        chainTxHash = ""; // traceable placeholder
    } 
    else 
    {
        // 🌿 NORMAL CASE: SEND USDT
        const txResult = await sendUsdt({
            idempotency_key: uniqueTransactionId,
            withdrawal_id: ledgerRow._id,
            amount: fixedAmount,
            destination: destinationAddress,
        });

        chainTxHash = txResult.txHash;
        // ❌ Missing hash = chain failed → force error
        if (!chainTxHash || typeof chainTxHash !== "string" || chainTxHash.trim() === "") {
            throw new Error("USDT transfer failed — no transaction hash returned.");
        }

        // Send email only on success
        sendTransactionSuccessEmail(ledgerRow.userId, {
            amountUSDT: fixedAmount,
            txHash: chainTxHash,
            txDate: new Date().toISOString(),
        });

        
    }

} catch (chainError) {
    console.error("❌ CHAIN SEND FAILED:", chainError);

    // LOG ERROR (ALWAYS)
    await WithdrawalErrorLog.create({
      userId,
      ledgerRowId: ledgerRow?._id,
      uniqueTransactionId,
      walletFrom,
      amount: amountD128,
      destinationAddress,
      memo: uniqueTransactionId,
      errorCode: chainError?.code || chainError?.name,
      errorMessage: chainError?.message,
      chainResponse: chainError,
      createdAt: new Date(),
    });

    // Mark main ledgerRow as FAILED
    ledgerRow.status = "FAILED";
    ledgerRow.narrative = chainError.message;
    await ledgerRow.save();

    // Keep user blocked until auto-reconciler fixes it
    ledger.withdrawalDisabled = true;
    await ledger.save();

    return res.status(400).json({
      success: false,
      disableWithdrawal: true,
      message: "Withdrawal in progress ...",
    });
}


// ✅ Mark main withdrawal as COMPLETED regardless of whether chain send was skipped
ledgerRow.status = "COMPLETED";
ledgerRow.refId = chainTxHash;
await ledgerRow.save();

// Trigger 2% Node fee airdrop distribution in background
distributeNodeFeeAirdrop(amountD128, userId).catch(err => {
    console.error("Error distributing node fee airdrop:", err);
});



// ---------------- Clear pendingWithdrawal & re-enable withdrawals ----------------

      ledger.pendingWithdrawal = undefined;
      ledger.withdrawalDisabled = false;
      await ledger.save();

      // Successful response
      return res.status(200).json({
        success: true,
        message: "Claim successful",
        transactionHash: chainTxHash,
        uniqueTransactionId,
        withdrawnFrom: walletFrom,
        newBalance: parseFloat(newBalance.toString()),
        disableWithdrawal: false,
        transferredAmount: parseFloat(amountD128.toString()),
        ecosystemFee: ecosystemFeeDeduction
          ? parseFloat(ecosystemFeeDeduction.toString())
          : 0,
        //  onchainDeposits: parseFloat(totalDeposits.toString()),
        //  onchainWithdrawals: parseFloat(totalWithdrawals.toString()),
        limitsAfterWithdrawal: {
          zeroRisk: parseFloat(ledger.wallets.zeroRisk.toString()),
          fiveX: parseFloat(ledger.limits.fiveXLimit.cap.toString()),
          swift: parseFloat(ledger.limits.swiftLimit.cap.toString()),
          boost: parseFloat(ledger.limits.boostLimit.cap.toString()),
        },
      });
    } catch (error) {
      // ------------------------------------------------------------------
      // PAYMENT FAILED – leave row in INITIATED state & log full details
      // ------------------------------------------------------------------
      try {
        if (ledgerRow) {
          ledgerRow.narrative = `Withdrawal error captured: ${error.message}`;
          await ledgerRow.save();
        }

        // Capture detailed error log
        await WithdrawalErrorLog.create({
          userId,
          ledgerRowId: ledgerRow?._id,
          uniqueTransactionId,
          walletFrom,
          amount: amountD128,
          destinationAddress,
          memo: uniqueTransactionId,
          errorCode:
            error?.result?.meta?.TransactionResult ||
            error?.code ||
            error?.name,
          errorMessage: error?.message,
          chainResponse: error?.result || error,
          stackTrace: error?.stack,
        });
      } catch (logErr) {
        console.error(
          "[WithdrawalErrorLog] Failed to record withdrawal error:",
          logErr
        );
      }

      // Note: we intentionally do NOT revert ledger deductions here. Reconciler
      // will credit the user if the payment is not found on-chain after X minutes.

      // Disable future withdrawals until reconciler completes
      try {
        if (ledger) {
          ledger.withdrawalDisabled = true;
          await ledger.save();
        }
      } catch (e) {
        console.error("Failed to set withdrawalDisabled flag:", e);
      }

      console.error("Withdrawal USDT send failed:", error);
      
      return res.status(400).json({
        success: false,
        disableWithdrawal: true,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("Error in withdrawUSDT:", error);
    
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};


// Get withdrawals history for authenticated user
const getWithdrawalsHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get withdrawal history from ledger rows
    const withdrawals = await LedgerRow.find({
      userId,
      eventType: { $in: ["WITHDRAWAL", "REWARDS_REDEEMED"] },
    })
      .sort({ ts: -1 })
      .select(
        "ts amount walletFrom narrative refId uniqueTransactionId transactionId status"
      )
      .lean();

    res.json({
      success: true,
      withdrawals: withdrawals.map((withdrawal) => ({
        uniqueTransactionId:
          withdrawal.uniqueTransactionId || withdrawal.transactionId, // Fall back to old field if needed
        transactionId: withdrawal.transactionId, // Keep old field
        txHash: withdrawal.refId, // chain transaction hash
        amount: parseFloat(withdrawal.amount).toFixed(6),
        walletFrom: withdrawal.walletFrom,
        narrative: withdrawal.narrative,
        timestamp: withdrawal.ts,
        status: withdrawal.status,
      })),
    });
  } catch (error) {
    console.error("Error fetching withdrawals history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawals history",
    });
  }
};

// ------------------------------------------------------------------
// GET /api/withdrawals/disabled – returns whether withdrawals are
// currently disabled for the authenticated user
// ------------------------------------------------------------------
const getWithdrawalDisabled = async (req, res) => {
  try {
    const userId = req.user._id;
    const ledger = await Ledger.findOne({ userId }).select(
      "withdrawalDisabled"
    );
    return res.json({
      success: true,
      disableWithdrawal: ledger?.withdrawalDisabled || false,
    });
  } catch (err) {
    console.error("Error fetching withdrawalDisabled flag:", err);
    return res
      .status(500)
      .json({ success: false, message: "Unable to fetch withdrawal status" });
  }
};
const redeemhk = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = getUTCDateString();
    const EVENT_NAME = "MACAU_HK_EVENT";

    // -----------------------------
    // Validate XRank
    // -----------------------------
    const user = await User.findById(userId).select("xRank uhid");
    if (!user || !user.xRank) {
      return res.status(403).json({
        success: false,
        message: "Only XRank users can redeem Macau/HK event rewards.",
      });
    }

    // -----------------------------
    // Fetch Event Reward
    // -----------------------------
    const event = await EventRewardCredit.findOne({
      userId,
      date: today,
      event: EVENT_NAME,
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "No event rewards available for today.",
      });
    }

    const remaining = parseFloat(event.remaining.toString());
    if (remaining <= 0) {
      return res.status(400).json({
        success: false,
        message: "You have already redeemed today's Macau/HK event reward.",
      });
    }

    // -----------------------------
    // Ledger
    // -----------------------------
    const ledger = await Ledger.findOne({ userId });
    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger not found.",
      });
    }

    const communityRewards = parseFloat(
      ledger.wallets.communityRewards?.toString() || "0"
    );

    if (communityRewards < remaining) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Community Rewards (${communityRewards}) to redeem ${remaining}`,
      });
    }

    // -----------------------------
    // Deduct Community Rewards
    // -----------------------------
    ledger.wallets.communityRewards = (communityRewards - remaining).toFixed(6);

    // -----------------------------
    // Deduct ZERO_RISK if available
    // -----------------------------
    const zeroRiskBal = parseFloat(ledger.wallets.zeroRisk?.toString() || "0");
    let deductedFromZeroRisk = 0;

    if (zeroRiskBal > 0) {
      deductedFromZeroRisk = Math.min(remaining, zeroRiskBal);
      ledger.wallets.zeroRisk = (zeroRiskBal - deductedFromZeroRisk).toFixed(6);
    }

    // -----------------------------
    // Update fiveXLimit.used
    // -----------------------------
    const used = parseFloat(ledger.limits.fiveXLimit.used?.toString() || "0");
    ledger.limits.fiveXLimit.used = (used + remaining).toFixed(6);

    // -----------------------------
    // Update totalRewardsWithdrawal
    // -----------------------------
    const totalWithdrawal = parseFloat(
      ledger.totalRewardsWithdrawal?.toString() || "0"
    );
    ledger.totalRewardsWithdrawal = (totalWithdrawal + remaining).toFixed(6);

    await ledger.save();

    // -----------------------------
    // Update EventRewardCredit
    // -----------------------------
    const redeemedSoFar = parseFloat(event.redeemed?.toString() || "0");
    event.redeemed = (redeemedSoFar + remaining).toFixed(6);
    event.remaining = "0";
    await event.save();

    // -----------------------------
    // LedgerRow Entry
    // -----------------------------
   const lrows= await LedgerRow.create({
      userId,
      eventType: "REWARDS_REDEEMED",
      walletFrom: "COMMUNITY_REWARDS",
      walletTo: "MACAU_HK_EVENT",
      amount: remaining,
      status: "COMPLETED",
      narrative: `Macau/HK Event reward redeemed`,
      ts: new Date(),
      deductedFromZeroRisk: deductedFromZeroRisk.toFixed(6),
    });

    // -----------------------------
    // 🔥 ON-CHAIN STYLE WITHDRAWAL LOG (cWithdrawals)
    // -----------------------------
    // const doc = {
    // txHash: lrows._id,
    //   userId: user._id,
    //   uhid: user.uhid,
    //   amount: remaining,
    //   source: "REWARDS_WALLET",
    //   destination: "MACAU_HK_EVENT",
    //   txDate: new Date(),
    //   raw: {
    //     type: "MACAU_HK_EVENT_REDEEM",
    //     note: "Onchain-style withdrawal log",
    //     redeemedAmount: remaining,
    //     deductedFromZeroRisk
    //   }
    // };

    // await ChainWithdrawal.create(doc);

    return res.status(200).json({
      success: true,
      message: "Macau/HK Event reward redeemed successfully.",
      redeemedAmount: remaining.toFixed(6),
      deductedFromZeroRisk: deductedFromZeroRisk.toFixed(6),
    });

  } catch (error) {
    console.error("❌ Error in redeemhk:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



const EVENT_NAME = "MACAU_HK_EVENT";
const EVENT_DAYS = ["2025-12-09", "2025-12-10", "2025-12-11", "2025-12-12"];

// Helper: returns YYYY-MM-DD in UTC
function getUTCDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
// --------------------------------------------------
// GET TOTAL REMAINING + TODAY'S CREDIT FOR EVENT
// --------------------------------------------------

// --------------------------------------------------
// GET TODAY'S CREDIT + TOTAL REMAINING FOR EVENT
// --------------------------------------------------
const getTodayEventRewards = async (req, res) => {
  try {
    const userId = req.user._id;

    // Today in UTC
    const today = getUTCDateString();

    // Only include event days up to today
    const activeDays = EVENT_DAYS.filter((d) => d <= today);

    // Fetch event records
    const records = await EventRewardCredit.find({
      userId,
      date: { $in: activeDays },
      event: EVENT_NAME,
    });

    if (!records.length) {
      return res.status(200).json({
        success: true,
        creditedToday: 0,
        totalRemaining: 0,
        breakdown: [],
      });
    }

    let creditedToday = 0;
    let totalRemaining = 0;

    const breakdown = records.map((rec) => {
      const credited = parseFloat(rec.credited?.toString() || "0");
      const redeemed = parseFloat(rec.redeemed?.toString() || "0");
      const remaining = parseFloat(rec.remaining?.toString() || "0");

      if (rec.date === today) creditedToday = credited;

      totalRemaining += remaining;

      return {
        date: rec.date,
        credited,
        redeemed,
        remaining,
      };
    });

    return res.status(200).json({
      success: true,
      creditedToday,
      totalRemaining,
      breakdown,
    });
  } catch (err) {
    console.error("❌ Error getTodayEventRewards:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  withdrawUSDT,
  getWithdrawalsHistory,
  getWithdrawalDisabled,
  redeemhk,
  getTodayEventRewards
};
