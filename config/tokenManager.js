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
    const tokenUrl = process.env.SECURE_TOKEN_URL;
    if (!tokenUrl) {
      throw new Error("SECURE_TOKEN_URL is not configured");
    }
    const res = await axios.get(tokenUrl);
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
