const { ethers } = require("ethers");

/**
 * Centralized Blockchain Configuration
 * Using PublicNode for both HTTP and WSS
 */

const BSC_CHAIN_ID = Number(process.env.BSC_CHAIN_ID || "56");
const HTTP_URL = process.env.BSC_MAINNET_RPC_URL || "https://bsc-rpc.publicnode.com";
const WSS_URL = process.env.BSC_MAINNET_WSS_URL || "wss://bsc.publicnode.com";

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
    const keepAlive = () => {
      if (provider.websocket && (provider.websocket.readyState === 1)) {
          // Connected
          return;
      }
      console.warn("⚠️ WebSocket is not open. Reconnection will be handled by ethers or manual reset.");
    };

    const interval = setInterval(keepAlive, 30000);

    provider.on("error", (err) => {
      console.error("❌ WebSocket Provider Error:", err);
      wssProvider = null; // Forces getWssProvider to recreate next time
      clearInterval(interval);
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
  
  if (!wssProvider) {
    console.warn("🔻 Falling back to HTTP provider for real-time listener (Not ideal).");
    return getHttpProvider();
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
