const path = require("path");
const mongoose = require("mongoose");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const connectDB = require("../config/db");
const User = require("../models/User");
require("../models/Ledger");
const { getOrCreateLedger, createLedgerEntry } = require("../jobs/helpers/ledgerHelpers");
const { addDecimal128, ensureDecimal128 } = require("../utils/decimal128Utils");

function printUsage() {
  console.log("Usage: node scripts/creditHorseNftFunding.js <email-or-userId> [amount]");
  console.log("Examples:");
  console.log("  node scripts/creditHorseNftFunding.js user@example.com 10000");
  console.log("  node scripts/creditHorseNftFunding.js 665f0c1d2e3f4a5b6c7d8e9f 10000");
}

async function main() {
  const [, , userLookupArg, amountArg] = process.argv;

  if (!userLookupArg) {
    printUsage();
    process.exit(1);
  }

  const creditAmount = amountArg == null ? 10000 : Number(amountArg);
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    console.error(`Invalid amount: ${amountArg}`);
    process.exit(1);
  }

  await connectDB();

  try {
    const userQuery = mongoose.Types.ObjectId.isValid(userLookupArg)
      ? { _id: userLookupArg }
      : { email: String(userLookupArg).trim().toLowerCase() };

    const user = await User.findOne(userQuery).select("_id username email uhid");
    if (!user) {
      throw new Error(`User not found for lookup ${userLookupArg}`);
    }

    const ledger = await getOrCreateLedger(user._id);
    if (!ledger.wallets) {
      ledger.wallets = {};
    }

    const previousSolBalance = ensureDecimal128(ledger.wallets.sol || "0.0");
    const previousUsdtBalance = ensureDecimal128(ledger.wallets.bnb || "0.0");
    const creditAmountD128 = ensureDecimal128(String(creditAmount));

    // Keep the visible dashboard SOL wallet and the Horse NFT spendable USDT wallet aligned.
    ledger.wallets.sol = addDecimal128(previousSolBalance, creditAmountD128);
    ledger.wallets.bnb = addDecimal128(previousUsdtBalance, creditAmountD128);
    ledger.markModified("wallets");
    await ledger.save();

    const refBase = `ADMIN_HORSE_FUNDING_TOPUP:${user._id.toString()}:${Date.now()}`;
    const actorLabel = user.username || user.email || user.uhid || user._id.toString();

    const [solLedgerEntry, usdtLedgerEntry] = await Promise.all([
      createLedgerEntry({
        userId: user._id,
        eventType: "INTERNAL_TRANSFER",
        amount: creditAmount,
        walletFrom: "ADMIN_TOPUP",
        walletTo: "SOL",
        narrative: `Admin internal SOL top-up of ${creditAmount} for ${actorLabel}`,
        refId: `${refBase}:SOL`,
      }),
      createLedgerEntry({
        userId: user._id,
        eventType: "INTERNAL_TRANSFER",
        amount: creditAmount,
        walletFrom: "ADMIN_TOPUP",
        walletTo: "USDT",
        narrative: `Admin internal USDT top-up of ${creditAmount} for ${actorLabel} to enable Horse NFT purchases`,
        refId: `${refBase}:USDT`,
      }),
    ]);

    console.log("Internal SOL + Horse NFT funding credited successfully.");
    console.log(
      JSON.stringify(
        {
          userId: user._id.toString(),
          username: user.username || null,
          email: user.email || null,
          uhid: user.uhid || null,
          amountCreditedToSol: creditAmount,
          amountCreditedToUsdt: creditAmount,
          previousSolBalance: previousSolBalance.toString(),
          newSolBalance: ledger.wallets.sol.toString(),
          previousUsdtBalance: previousUsdtBalance.toString(),
          newUsdtBalance: ledger.wallets.bnb.toString(),
          solLedgerRowId: solLedgerEntry._id.toString(),
          usdtLedgerRowId: usdtLedgerEntry._id.toString(),
          refBase,
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to credit Horse NFT funding wallets:", error.message);
  process.exit(1);
});
