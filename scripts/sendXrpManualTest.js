/**
 * Manual USDT (BEP20) Send Test
 *
 * Usage:
 *   node scripts/sendXrpManualTest.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
// utils/transactions.js
const TokenTxLog = require("../models/TokenTxLog");
const { sendUsdt } = require("../utils/usdtTransactions");

/**
 * 🪙 Send USDT on BSC using the hot wallet signer
 *
 * @param {Object} payload - The withdrawal details
 * @param {string} payload.idempotency_key - Unique key for deduplication
 * @param {string} payload.withdrawal_id - Internal ID for your record
 * @param {string|number} payload.amount_usdt - Amount in USDT (as string or number)
 * @param {string} payload.destination - BSC wallet address (destination)
 *
 * @returns {Promise<Object>} - API response (success or error)
 */

async function sendUsdtManual(payload) {
  try {
    const result = await sendUsdt({
      destination: payload.destination,
      amount: payload.amount_usdt,
      memo: payload.idempotency_key,
    });

    await TokenTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount: payload.amount_usdt,
      currency: "USDT",
      network: "BEP20",
      tx_hash: result.txHash,
      response: result,
    });

    return result;
  } catch (err) {
    await TokenTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount: payload.amount_usdt,
      currency: "USDT",
      network: "BEP20",
      response: err.message,
    });

    throw err;
  }
}


async function run() {
  try {
    // -----------------------------
    // CONNECT DB (required for XrpTxLog)
    // -----------------------------
    await connectDB();
    console.log("✅ MongoDB connected");

    // -----------------------------
    // DUMMY / MANUAL PAYLOAD
    // -----------------------------
    const payload = {
      withdrawal_id: "69670be3aqw03f55c0d507816365",
      idempotency_key: "733b0674-b6f7-4c81-va46-ad49c691698579",
      destination: "0x0000000000000000000000000000000000000000",
      amount_usdt: "1",
    };

    console.log("📦 Payload being sent:");
    console.log(payload);

    // -----------------------------
    // SEND USDT
    // -----------------------------
    const result = await sendUsdtManual(payload);

    console.log("🎉 USDT SENT SUCCESSFULLY");
    console.dir(result, { depth: null });

  } catch (err) {
    console.error("❌ USDT SEND FAILED");

    // FULL ERROR VISIBILITY
    console.error("Message:", err.message);
    console.error("Name:", err.name);

    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("API Response:", err.response.data);
    } else {
      console.error("Error:", err);
    }

  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected");
    process.exit(0);
  }
}

run();
