// utils/transactions.js
const axios = require("axios");
const { getValidToken } = require("../config/tokenManager");
const XrpTxLog = require("../models/XrpTxLog");

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
// async function sendXrp(payload) {
//   try {
//     // ✅ Ensure we have a fresh token
//     const token = await getValidToken();

//     const response = await axios.post(
//       "https://payments.BEPVault.io/v1/withdrawals",
//       payload,
//       {
//         headers: {
//           Authorization: `Bearer ${token}`,
//           "Content-Type": "application/json",
//         },
//         timeout: 15000, // 15 seconds safety timeout
//       }
//     );

//     console.log("✅ XRP withdrawal success:", response.data);
//       await XrpTxLog.create({
//         withdrawal_id: payload.withdrawal_id,
//         idempotency_key: payload.idempotency_key,
//         destination: payload.destination,
//         amount_xrp: payload.amount_xrp,
//         response: response.data,
//       });
//     return response.data;
//   } catch (err) {
//     if (err.response) {
//       console.error("❌ Withdrawal failed:", err.response.data);
//          await XrpTxLog.create({
//         withdrawal_id: payload.withdrawal_id,
//         idempotency_key: payload.idempotency_key,
//         destination: payload.destination,
//         amount_xrp: payload.amount_xrp,
//         response: err.response.data,
//       });
//       return { success: false, error: err.response.data };
//     } else {
//       console.error("❌ Network or unexpected error:", err.message);
//       await XrpTxLog.create({
//         withdrawal_id: payload.withdrawal_id,
//         idempotency_key: payload.idempotency_key,
//         destination: payload.destination,
//         amount_xrp: payload.amount_xrp,
//         response: err.response.data,
//       });
//       return { success: false, error: err.message };
//     }
//   }
// }
async function sendXrp(payload) {
  const token = await getValidToken();

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

module.exports = { sendXrp };
