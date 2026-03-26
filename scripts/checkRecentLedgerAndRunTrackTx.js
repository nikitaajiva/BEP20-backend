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
const path = require('path');
const mongoose = require('mongoose');
const { spawn } = require('child_process');
const axios = require("axios");
const connectDB = require("../config/db");
const DepositAddress = require("../models/DepositAddress");
const trackChainScript = path.join(__dirname, '../scripts/trackChainTx.js');
const checkMissingDepositsScript = path.join(__dirname, '../scripts/checkMissingDeposits.js');
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

// ====== FUNCTION ======
function callTrackChainTx(xrpAddress) {
  return new Promise((resolve) => {
    if (!xrpAddress) {
      console.log(`⚠️ No XRP address provided for trackChainTx`);
      return resolve();
    }

    try {
      const child = spawn('node', [trackChainScript, xrpAddress], {
        stdio: 'ignore',
        detached: true,
      });

      child.on('error', (error) => {
        console.log(`⚠️ trackChainTx spawn error for ${xrpAddress}:`, error.message);
        resolve();
      });

      child.on('exit', (code) => {
        if (code === 0) {
          console.log(`✅ trackChainTx completed successfully for ${xrpAddress}`);
        } else {
          console.log(`⚠️ trackChainTx exited with code ${code} for ${xrpAddress}`);
        }
        resolve();
      });

      console.log(`🔄 trackChainTx started for user: ${xrpAddress}`);
      child.unref();
    } catch (error) {
      console.log(`❌ trackChainTx function error for ${xrpAddress}:`, error.message);
      resolve();
    }
  });
}

// ====== RUN FINAL SCRIPT (ONCE) ======
function runCheckMissingDeposits() {
  try {
    console.log('🚀 Running checkMissingDeposits.js (once)...');
    const child = spawn('node', [checkMissingDepositsScript], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ checkMissingDeposits.js completed successfully.');
      } else {
        console.log(`⚠️ checkMissingDeposits.js exited with code ${code}.`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to run checkMissingDeposits.js:', error.message);
  }
}
// ----------------------------- MAIN ----------------------------------
(async function main() {
  try {
    await connectDB();

    const fiveMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

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
          await callTrackChainTx(tx.sender);
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
      runCheckMissingDeposits();
    process.exit(0);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    await mongoose.disconnect();
      runCheckMissingDeposits();
    process.exit(1);
  }
})();



// /**
//  * scripts/checkRecentLedgerAndRunTrackTx.js
//  * -----------------------------------------
//  * 1. Fetch LedgerRows from the last 10 minutes
//  *    where eventType ∈ ["REWARDS_REDEEMED", "WITHDRAWAL", "DEPOSIT"]
//  * 2. Find users' unique XRP addresses
//  * 3. Run trackChainTx.js once per distinct address
//  * 4. After all done, run checkMissingDeposits.js (once only)
//  */

// require('dotenv').config();
// const path = require('path');
// const mongoose = require('mongoose');
// const { spawn } = require('child_process');

// // ====== CONFIG ======
// const connectDB = require('../config/db');
// const LedgerRow = require('../models/LedgerRow');
// const User = require('../models/User');

// const trackChainScript = path.join(__dirname, '../scripts/trackChainTx.js');
// const checkMissingDepositsScript = path.join(__dirname, '../scripts/checkMissingDeposits.js');

// // ====== FUNCTION ======
// function callTrackChainTx(xrpAddress) {
//   return new Promise((resolve) => {
//     if (!xrpAddress) {
//       console.log(`⚠️ No XRP address provided for trackChainTx`);
//       return resolve();
//     }

//     try {
//       const child = spawn('node', [trackChainScript, xrpAddress], {
//         stdio: 'ignore',
//         detached: true,
//       });

//       child.on('error', (error) => {
//         console.log(`⚠️ trackChainTx spawn error for ${xrpAddress}:`, error.message);
//         resolve();
//       });

//       child.on('exit', (code) => {
//         if (code === 0) {
//           console.log(`✅ trackChainTx completed successfully for ${xrpAddress}`);
//         } else {
//           console.log(`⚠️ trackChainTx exited with code ${code} for ${xrpAddress}`);
//         }
//         resolve();
//       });

//       console.log(`🔄 trackChainTx started for user: ${xrpAddress}`);
//       child.unref();
//     } catch (error) {
//       console.log(`❌ trackChainTx function error for ${xrpAddress}:`, error.message);
//       resolve();
//     }
//   });
// }

// // ====== RUN FINAL SCRIPT (ONCE) ======
// function runCheckMissingDeposits() {
//   try {
//     console.log('🚀 Running checkMissingDeposits.js (once)...');
//     const child = spawn('node', [checkMissingDepositsScript], {
//       stdio: 'inherit',
//     });

//     child.on('exit', (code) => {
//       if (code === 0) {
//         console.log('✅ checkMissingDeposits.js completed successfully.');
//       } else {
//         console.log(`⚠️ checkMissingDeposits.js exited with code ${code}.`);
//       }
//     });
//   } catch (error) {
//     console.error('❌ Failed to run checkMissingDeposits.js:', error.message);
//   }
// }

// // ====== MAIN ======
// (async () => {
//   await connectDB();

//   const now = new Date();
//   const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

//   console.log(`🕒 Checking LedgerRows (last 10 minutes): ${tenMinutesAgo.toISOString()} → ${now.toISOString()}`);

//   try {
//     const filter = {
//       updatedAt: { $gte: tenMinutesAgo },
//       eventType: { $in: ['REWARDS_REDEEMED', 'WITHDRAWAL', 'DEPOSIT'] },
//     };

//     const recentRows = await LedgerRow.find(filter).limit(500); // optional safety limit

//     if (recentRows.length === 0) {
//       console.log('⚠️ No matching LedgerRows found in the last 10 minutes.');
//       mongoose.connection.close();
//       return runCheckMissingDeposits();
//     }

//     console.log(`✅ Found ${recentRows.length} matching LedgerRows.`);

//     // Get all unique userIds
//     const userIds = [...new Set(recentRows.map((r) => r.userId?.toString()).filter(Boolean))];

//     // Fetch corresponding users with xrpAddress
//     const users = await User.find({ _id: { $in: userIds } }, { xrpAddress: 1 });

//     // Extract unique XRP addresses
//     const distinctAddresses = [
//       ...new Set(users.map((u) => u.xrpAddress).filter(Boolean)),
//     ];

//     console.log(`🔹 Found ${distinctAddresses.length} unique XRP addresses to process.`);

//     // Run each trackChainTx sequentially
//     for (const addr of distinctAddresses) {
//       await callTrackChainTx(addr);
//     }

//     console.log('✅ All trackChainTx jobs finished.');
//   } catch (err) {
//     console.error('❌ Error fetching LedgerRows:', err);
//   } finally {
//     mongoose.connection.close();
//     runCheckMissingDeposits(); // <-- runs once, after all jobs done
//   }
// })();
