const { ethers } = require("ethers");

/**
 * Centralized Blockchain Configuration
 * Using PublicNode for both HTTP and WSS
 */

const BSC_CHAIN_ID = Number(process.env.BSC_CHAIN_ID || "56");
const HTTP_URL = process.env.BSC_MAINNET_RPC_URL || "https://bsc-rpc.publicnode.com";
const WSS_URL = process.env.BSC_MAINNET_WSS_URL || "wss://bsc.publicnode.com";
const USE_WSS =
  String(process.env.BSC_WATCHER_USE_WSS || "true").trim().toLowerCase() ===
  "true";

// Shared Provider Handles
let httpProvider = null;
let wssProvider = null;

/**
 * Get HTTP JSON-RPC Provider
 * Used for balance checks, transaction sending, and general API calls.
 */
function getHttpProvider() {
  if (!httpProvider) {
    httpProvider = new ethers.JsonRpcProvider(HTTP_URL, {
      chainId: BSC_CHAIN_ID,
      name: "binance",
    });
  }
  return httpProvider;
}

/**
 * Create a new WebSocket Provider with auto-reconnect logic
 * Used ONLY for real-time listeners (BscWatcherService).
 */
function createWebSocketProvider() {
  if (!USE_WSS) {
    console.warn("🔻 BSC WebSocket watcher disabled via BSC_WATCHER_USE_WSS=false");
    return null;
  }

  if (!WSS_URL) {
    console.warn("🔻 BSC WebSocket URL is missing. Falling back to HTTP polling.");
    return null;
  }

  try {
    console.log("🔌 Connecting to BSC WebSocket:", WSS_URL);
    
    // Create the provider
    const provider = new ethers.WebSocketProvider(WSS_URL, {
      chainId: BSC_CHAIN_ID,
      name: "binance",
    });

    // We don't want to crash the whole process if WSS fails
    // Ethers v6 WebSocketProvider will attempt connection 
    
    // Keep-alive/Reconnection logic
    const getSocket = () => provider.websocket || provider._websocket || null;

    const keepAlive = () => {
      const socket = getSocket();
      if (socket && socket.readyState === 1) {
        return;
      }
      console.warn(
        "⚠️ BSC WebSocket is not open. Polling fallback should continue."
      );
    };

    const interval = setInterval(keepAlive, 30000);

    const handleSocketFailure = (label, err) => {
      console.error(`❌ BSC WebSocket ${label}:`, err?.message || err);
      wssProvider = null;
      clearInterval(interval);
    };

    const socket = getSocket();
    if (socket && typeof socket.on === "function") {
      socket.on("error", (err) => handleSocketFailure("socket error", err));
      socket.on("close", (code, reason) => {
        handleSocketFailure(
          `socket closed (${code})`,
          reason ? reason.toString() : "closed"
        );
      });
    }

    provider.on("error", (err) => {
      handleSocketFailure("provider error", err);
    });

    return provider;
  } catch (err) {
    console.error("❌ Fatal error creating WebSocket provider:", err);
    return null;
  }
}

/**
 * Get (or initialize) the shared WebSocket Provider
 * Returns the WebSocket provider if available, otherwise falls back to HTTP provider.
 */
function getWssProvider() {
  if (!wssProvider) {
    wssProvider = createWebSocketProvider();
  }

  return wssProvider;
}

module.exports = {
  getHttpProvider,
  getWssProvider,
  BSC_CHAIN_ID,
  USDT_CONTRACT_ADDRESS: process.env.USDT_CONTRACT_ADDRESS_MAINNET,
  BSC_CONFIRMATIONS: Number(process.env.BSC_CONFIRMATIONS || "3"),
};
