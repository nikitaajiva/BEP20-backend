/**
 * Auto-update recent DepositAddress records with XRPL on-chain deposit data
 *
 * Steps:
 * 1️⃣ Find all DepositAddress docs created in last 5 mins where isActive:true
 * 2️⃣ For each (wallet_address + destination_tag):
 *       -> Query XRPL QuickNode endpoint (account_tx)
 *       -> Find recent Payment tx to that address with same tag
 *       -> Update DepositAddress record with txHash, source, amountXRP
 *
 * Run:
 *   node scripts/updateRecentDeposits.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const connectDB = require("../config/db");
const DepositAddress = require("../models/DepositAddress");

// ----------------------------- CONFIG ----------------------------------
const XRPL_RPC_URL =
  process.env.XRPL_QUICKNODE_HTTPS ||
  "https://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7";

// ----------------------------- HELPERS ----------------------------------
function rippleTimeToDate(rippleSeconds) {
  return new Date((rippleSeconds + 946684800) * 1000);
}

function dropsToXrp(drops) {
  return typeof drops === "string" ? Number(drops) / 1_000_000 : 0;
}

// ----------------------------- XRPL QUERY ----------------------------------
async function findDepositTx(destination, tag) {
  let marker = null;

  do {
    const body = {
      method: "account_tx",
      params: [
        {
          account: destination,
          binary: false,
          forward: false,
          ledger_index_min: -1,
          ledger_index_max: -1,
          limit: 200,
          ...(marker ? { marker } : {}),
        },
      ],
      id: 1,
      jsonrpc: "2.0",
    };

    const { data } = await axios.post(XRPL_RPC_URL, body, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    const result = data.result;
    if (!result || !result.transactions) break;

    for (const txObj of result.transactions) {
      const tx = txObj.tx;
      if (
        tx &&
        tx.TransactionType === "Payment" &&
        tx.Destination === destination &&
        tx.DestinationTag === tag
      ) {
        const amountDrops =
          tx.Amount || txObj.meta?.DeliveredAmount || txObj.meta?.delivered_amount;
        const amountXRP = dropsToXrp(amountDrops);
        return {
          txHash: tx.hash,
          sender: tx.Account,
          amountXRP,
          ledger: tx.ledger_index,
          date: rippleTimeToDate(tx.date).toISOString(),
        };
      }
    }

    marker = result.marker || null;
  } while (marker);

  return null;
}

// ----------------------------- MAIN ----------------------------------
(async function main() {
  try {
    await connectDB();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentAddresses = await DepositAddress.find({
      isActive: true,
      createdAt: { $gte: fiveMinutesAgo },
    }).lean();

    console.log(`🔍 Found ${recentAddresses.length} active deposit addresses (last 5 mins)`);

    for (const addr of recentAddresses) {
      const { wallet_address, destination_tag, _id } = addr;

      console.log(`→ Checking address: ${wallet_address} | Tag: ${destination_tag}`);
      const tx = await findDepositTx(wallet_address, destination_tag);

      if (tx) {
        console.log(`✅ Found deposit TX: ${tx.txHash} | ${tx.amountXRP} XRP`);
        await DepositAddress.updateOne(
          { _id },
          {
            $set: {
              isActive: false,
              source_address: tx.sender,
              txHash: tx.txHash,
              amount_xrp: tx.amountXRP,
              updatedAt: new Date(),
            },
          }
        );
      } else {
        console.log("⚠️ No deposit found for this tag yet.");
      }
    }

    console.log("✅ Done checking all recent addresses.");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    await mongoose.disconnect();
    process.exit(1);
  }
})();
