// config/tokenManager.js
require('dotenv').config();
const axios = require("axios");
const cron = require("node-cron");

let cachedToken = null;

// Helper: check if token expired
function isTokenExpired() {
  if (!cachedToken || !cachedToken.expiresAt) return true;
  const now = new Date();
  const expiry = new Date(cachedToken.expiresAt);
  // Add a 2-minute buffer to refresh slightly before expiration
  return now.getTime() + 2 * 60 * 1000 >= expiry.getTime();
}

// Fetch new token from API
async function fetchNewToken() {
  try {
    const res = await axios.get("https://pay.BEPVault.io/v1/getJwt");
    const { token, expiresAt } = res.data;

    cachedToken = { token, expiresAt };
    process.env.SECURE_TOKEN = token;

    console.log(`✅ SECURE_TOKEN fetched. Expires at: ${expiresAt}`);
  } catch (err) {
    console.error("❌ Failed to fetch SECURE_TOKEN:", err.message);
  }
}

// Get valid token (only refresh if expired)
async function getValidToken() {
  if (isTokenExpired()) {
    console.log("🔄 Token expired or missing — fetching new one...");
    await fetchNewToken();
  } else {
    // Keep using current one
    process.env.SECURE_TOKEN = cachedToken.token;
  }
  // Guard: fetchNewToken may have failed (e.g. network timeout), leaving cachedToken null
  if (!cachedToken) {
    console.warn("⚠️  No valid SECURE_TOKEN available (fetch failed). Returning null.");
    return null;
  }
  return cachedToken.token;
}

// Schedule check every 12 hours — but only refresh if expired
cron.schedule("0 */12 * * *", async () => {
  console.log("🕒 Scheduled token check triggered...");
  if (isTokenExpired()) {
    await fetchNewToken();
  } else {
    console.log("✅ Existing SECURE_TOKEN still valid — no refresh needed.");
  }
});

// Initialize on startup
getValidToken();

module.exports = { getValidToken };
