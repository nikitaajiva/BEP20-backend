const TokenTxLog = require("../models/TokenTxLog");
const { sendUsdt } = require("./usdtTransactions");

async function sendToken(payload) {
  try {
    const txResult = await sendUsdt({
      destination: payload.destination,
      amount: payload.amount,
      memo: payload.idempotency_key,
    });

    await TokenTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount: payload.amount,
      response: txResult,
    });

    return {
      txHash: txResult.txHash || null,
      raw: txResult,
    };
  } catch (err) {
    await TokenTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount: payload.amount,
      response: err?.response?.data || err.message,
      error: err.message,
    });
    throw err;
  }
}

module.exports = { sendToken };
