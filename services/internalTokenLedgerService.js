const mongoose = require("mongoose");
const Ledger = require("../models/Ledger");
const RewardTransaction = require("../models/RewardTransaction");

const TOKEN_BALANCE_FIELDS = {
  TSC_AVAILABLE: "tscAvailable",
  TSC_LOCKED: "tscLocked",
  TSC_VESTING: "tscVesting",
  TKC: "tkc",
};

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(String(value || "0"));

const toNumber = (value) => Number(value?.toString?.() || value || 0);

const decimalAdd = (a, b) =>
  toDecimal128((toNumber(a) + Number(b)).toString());

const decimalSubtract = (a, b) =>
  toDecimal128((toNumber(a) - Number(b)).toString());

const getOrCreateUserLedger = async (userId, session = null) => {
  let query = Ledger.findOne({ userId });
  if (session) query = query.session(session);

  let ledger = await query;

  if (!ledger) {
    ledger = new Ledger({
      _id: userId,
      userId: userId,
      wallets: {},
    });
  }

  if (!ledger.wallets) ledger.wallets = {};

  for (const field of Object.values(TOKEN_BALANCE_FIELDS)) {
    if (!ledger.wallets[field]) {
      ledger.wallets[field] = toDecimal128("0");
    }
  }

  await ledger.save({ session });

  return ledger;
};

const postTokenTransaction = async ({
  userId,
  asset,
  balanceField,
  direction,
  type,
  amount,
  idempotencyKey,
  referenceId = null,
  sourceUser = null,
  sourceNft = null,
  metadata = {},
  createdBy = null,
  session = null,
}) => {
  if (!userId) throw new Error("USER_ID_REQUIRED");
  if (!asset || !["TSC", "TKC"].includes(asset)) throw new Error("INVALID_ASSET");
  if (!balanceField || !Object.values(TOKEN_BALANCE_FIELDS).includes(balanceField)) {
    throw new Error("INVALID_BALANCE_FIELD");
  }
  if (!["CREDIT", "DEBIT"].includes(direction)) throw new Error("INVALID_DIRECTION");
  if (!type) throw new Error("TRANSACTION_TYPE_REQUIRED");
  if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error("INVALID_TOKEN_AMOUNT");
  }

  const existing = await RewardTransaction.findOne({ idempotencyKey }).session(session);

  if (existing) {
    return {
      alreadyPosted: true,
      transaction: existing,
      ledger: await getOrCreateUserLedger(userId, session),
    };
  }

  const ledger = await getOrCreateUserLedger(userId, session);

  const current = toNumber(ledger.wallets[balanceField]);

  if (direction === "DEBIT" && current < amountNum) {
    throw new Error("INSUFFICIENT_TOKEN_BALANCE");
  }

  ledger.wallets[balanceField] =
    direction === "CREDIT"
      ? decimalAdd(ledger.wallets[balanceField], amountNum)
      : decimalSubtract(ledger.wallets[balanceField], amountNum);

  await ledger.save({ session });

  const [transaction] = await RewardTransaction.create(
    [
      {
        user: userId,
        asset,
        direction,
        type,
        amount: toDecimal128(amountNum),
        balanceField,
        referenceId,
        idempotencyKey,
        sourceUser,
        sourceNft,
        metadata,
        createdBy,
        status: "POSTED",
      },
    ],
    { session }
  );

  return {
    alreadyPosted: false,
    transaction,
    ledger,
  };
};

const creditTscAvailable = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_AVAILABLE,
    direction: "CREDIT",
  });

const debitTscAvailable = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_AVAILABLE,
    direction: "DEBIT",
  });

const creditTscLocked = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_LOCKED,
    direction: "CREDIT",
  });

const debitTscLocked = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_LOCKED,
    direction: "DEBIT",
  });

const creditTscVesting = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_VESTING,
    direction: "CREDIT",
  });

const debitTscVesting = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TSC",
    balanceField: TOKEN_BALANCE_FIELDS.TSC_VESTING,
    direction: "DEBIT",
  });

const creditTkc = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TKC",
    balanceField: TOKEN_BALANCE_FIELDS.TKC,
    direction: "CREDIT",
  });

const debitTkc = (params) =>
  postTokenTransaction({
    ...params,
    asset: "TKC",
    balanceField: TOKEN_BALANCE_FIELDS.TKC,
    direction: "DEBIT",
  });

module.exports = {
  TOKEN_BALANCE_FIELDS,
  getOrCreateUserLedger,
  postTokenTransaction,
  creditTscAvailable,
  debitTscAvailable,
  creditTscLocked,
  debitTscLocked,
  creditTscVesting,
  debitTscVesting,
  creditTkc,
  debitTkc,
};
