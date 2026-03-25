/**
 * sendXrp.js
 * ----------------------------------------
 * Safe XRP sender (MAINNET)
 * - Static seed inside this file
 * - Validated ledger only
 * - submitAndWait (guaranteed broadcast)
 * - Returns txHash reliably
 */

const xrpl = require("xrpl");

/* ================= XRPL CONFIG ================= */
const XRPL_ENDPOINT = "wss://s1.ripple.com"; // MAINNET
// const XRPL_ENDPOINT = "wss://s.altnet.rippletest.net:51233"; // TESTNET

/* ================= STATIC HOT WALLET SEED ================= */
/**
 * ⚠️ IMPORTANT
 * - Do NOT commit this file publicly
 * - Restrict permissions: chmod 600 sendXrp.js
 */
const HOT_WALLET_SEED = "sEdToQbuXbEB3Wq5v13jpYuJhJBWqbM"; // <-- YOUR SEED

/* ================= INTERNAL STATE ================= */
const client = new xrpl.Client(XRPL_ENDPOINT);
const wallet = xrpl.Wallet.fromSeed(HOT_WALLET_SEED);
let connected = false;

/* ================= HELPERS ================= */

/**
 * Ensure XRPL client is connected
 */
async function getClient() {
  if (!connected) {
    await client.connect();
    connected = true;
    console.log("🔌 XRPL connected");
  }
  return client;
}

/**
 * Check XRPL account existence (validated ledger)
 */
async function accountExists(client, address) {
  try {
    await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return true;
  } catch (e) {
    if (e?.data?.error === "actNotFound") return false;
    throw e;
  }
}

/* ================= MAIN SEND FUNCTION ================= */

/**
 * Send XRP and wait for validation
 *
 * @param {Object} params
 * @param {string} params.destination - Receiver XRP address
 * @param {number|string} params.amount_xrp - XRP amount
 * @param {number} [params.destinationTag] - Optional destination tag
 * @param {string} [params.memo] - Optional memo (string)
 *
 * @returns {Object} { success, txHash, ledgerIndex }
 */
async function sendXrp({
  destination,
  amount_xrp,
  destinationTag,
  memo,
}) {
  if (!destination) throw new Error("Destination address missing");
  if (!amount_xrp || Number(amount_xrp) <= 0)
    throw new Error("Invalid XRP amount");

  const client = await getClient();

  console.log("🚀 XRPL SEND INIT", {
    from: wallet.address,
    to: destination,
    amount_xrp,
    destinationTag,
  });

  // Ensure sender exists
  if (!(await accountExists(client, wallet.address))) {
    throw new Error("Hot wallet is not activated on XRPL");
  }

  // Ensure destination exists
  if (!(await accountExists(client, destination))) {
    throw new Error("Destination account is not activated on XRPL");
  }

  /* -------- Build TX -------- */
  const tx = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: destination,
    Amount: xrpl.xrpToDrops(amount_xrp.toString()),
  };

  if (destinationTag !== undefined && destinationTag !== null) {
    tx.DestinationTag = Number(destinationTag);
  }

  if (memo) {
    tx.Memos = [
      {
        Memo: {
          MemoData: Buffer.from(memo).toString("hex"),
        },
      },
    ];
  }

  /* -------- Autofill → Sign -------- */
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);

  console.log("🔐 TX HASH:", signed.hash);

  /* -------- Submit & Wait (validated) -------- */
  const result = await client.submitAndWait(signed.tx_blob);

  const txResult = result?.result?.meta?.TransactionResult;
  console.log("📜 XRPL RESULT:", txResult);

  if (txResult !== "tesSUCCESS") {
    throw new Error(`XRPL TX FAILED: ${txResult}`);
  }

  return {
    success: true,
    txHash: signed.hash,
    ledgerIndex: result.result.ledger_index,
  };
}

/* ================= SHUTDOWN ================= */

/**
 * Gracefully disconnect the XRPL websocket client
 */
async function shutdown() {
  if (connected) {
    await client.disconnect();
    connected = false;
    console.log("🔌 XRPL client disconnected.");
  }
}

/* ================= EXPORT ================= */
module.exports = {
  sendXrp,
  shutdown,
};
