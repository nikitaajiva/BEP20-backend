const mongoose = require("mongoose");
const Ledger = require("../models/Ledger");

const toDecimal128 = (value) => {
  return mongoose.Types.Decimal128.fromString(String(value || "0"));
};

const decimalAdd = (a, b) => {
  const left = Number(a?.toString?.() || a || 0);
  const right = Number(b?.toString?.() || b || 0);
  return mongoose.Types.Decimal128.fromString((left + right).toString());
};

const getOrCreateUserLedger = async (userId, session = null) => {
  let ledger = await Ledger.findOne({ userId: userId }).session(session);

  if (!ledger) {
    ledger = new Ledger({
      userId: userId,
      wallets: {
        sol: toDecimal128("0"),
      },
    });

    await ledger.save({ session });
  }

  if (!ledger.wallets) ledger.wallets = {};
  if (!ledger.wallets.sol) ledger.wallets.sol = toDecimal128("0");

  return ledger;
};

const creditInternalSolWallet = async ({
  userId,
  amountSol,
  session = null,
}) => {
  if (!userId) {
    throw new Error("USER_ID_REQUIRED");
  }

  const amount = Number(amountSol);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_SOL_CREDIT_AMOUNT");
  }

  const ledger = await getOrCreateUserLedger(userId, session);

  ledger.wallets.sol = decimalAdd(ledger.wallets.sol, amount);

  // Since depositService uses zeroRisk and zeroRiskIpfs for BNB deposits,
  // we do the same here to keep it identical to previous logic, as requested in my previous context.
  ledger.wallets.zeroRisk = decimalAdd(ledger.wallets.zeroRisk, amount);
  ledger.wallets.zeroRiskIpfs = decimalAdd(ledger.wallets.zeroRiskIpfs, amount);
  ledger.markModified("wallets");

  await ledger.save({ session });

  return ledger;
};

const debitInternalSolWallet = async ({
  userId,
  amountSol,
  session = null,
}) => {
  if (!userId) {
    throw new Error("USER_ID_REQUIRED");
  }

  const amount = Number(amountSol);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_SOL_DEBIT_AMOUNT");
  }

  const ledger = await getOrCreateUserLedger(userId, session);

  const current = Number(ledger.wallets.sol?.toString?.() || 0);

  if (current < amount) {
    throw new Error("INSUFFICIENT_INTERNAL_SOL_BALANCE");
  }

  ledger.wallets.sol = toDecimal128((current - amount).toString());
  ledger.markModified("wallets");

  await ledger.save({ session });

  return ledger;
};

module.exports = {
  getOrCreateUserLedger,
  creditInternalSolWallet,
  debitInternalSolWallet,
};
