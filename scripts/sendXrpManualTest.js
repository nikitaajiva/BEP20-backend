/**
 * Manual XRP Send Test
 *
 * Usage:
 *   node scripts/sendXrpManualTest.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
// utils/transactions.js
const axios = require("axios");
// const { getValidToken } = require("../config/tokenManager");
const XrpTxLog = require("../models/XrpTxLog");
const getValidToken  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0ZXIiLCJpYXQiOjE3NjgzNjIyNjEsImV4cCI6MTc2ODQ0ODY2MX0.av0OYtCUtMKHTxw2koJ53tN8H_PcOa0zArzmJvv08tU";

/**
 * 🪙 Send XRP using the Secure Payments API
 *
 * @param {Object} payload - The withdrawal details
 * @param {string} payload.idempotency_key - Unique key for deduplication
 * @param {string} payload.withdrawal_id - Internal ID for your record
 * @param {string|number} payload.amount_xrp - Amount in XRP (as string or number)
 * @param {string} payload.destination - XRP wallet address (destination)
 *
 * @returns {Promise<Object>} - API response (success or error)
 */

async function sendXrp(payload) {
  const token = getValidToken;// await getValidToken();

  try {
    const response = await axios.post(
      "https://pay.BEPVault.io/v1/withdrawals",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    if (!response.data || response.data.success === false) {
      throw new Error(
        response.data?.message || "XRPL withdrawal rejected"
      );
    }

    await XrpTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount_xrp: payload.amount_xrp,
      response: response.data,
    });

    return {
      txHash: response.data?.quicknode?.tx_json?.hash || null,
      raw: response.data,
    };

  } catch (err) {
    await XrpTxLog.create({
      withdrawal_id: payload.withdrawal_id,
      idempotency_key: payload.idempotency_key,
      destination: payload.destination,
      amount_xrp: payload.amount_xrp,
      response: err.response?.data || err.message,
    });

    throw err; // ⛔ IMPORTANT
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
      withdrawal_id:"69670be3aqw03f55c0d507816365", // ✅ must be ObjectId
      idempotency_key: "733b0674-b6f7-4c81-va46-ad49c691698579",
      destination: "rwDzgMGFS9cr4dy6TZFkP5qoBLsc5QLGNd", // test XRPL address
      amount_xrp: "1", 
      wtype:"ipfs"
    };

    console.log("📦 Payload being sent:");
    console.log(payload);

    // -----------------------------
    // SEND XRP
    // -----------------------------
    const result = await sendXrp(payload);

    console.log("🎉 XRP SENT SUCCESSFULLY");
    console.dir(result, { depth: null });

  } catch (err) {
    console.error("❌ XRP SEND FAILED");

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
