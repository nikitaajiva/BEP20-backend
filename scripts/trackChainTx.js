// /*
//   Track Chain Transactions Script
//   --------------------------------
//   • Fetch all Ledgers sorted by LP balance (DESC) where LP > 0
//   • Join Users on UHID to obtain XRP address
//   • Query XRPL for each XRP address and classify transactions:
//        - Deposit   : tx.Account === userAddr AND OUR_DEPOSIT_DESTS includes tx.Destination
//        - Withdrawal: OUR_WITHDRAWAL_SOURCES includes tx.Account
//   • Store results into two collections: chain_deposits, chain_withdrawals

//   Run with:  node backend/scripts/trackChainTx.js

//   NOTE: Fill OUR_DEPOSIT_DESTS and OUR_WITHDRAWAL_SOURCES arrays below.
// */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const connectDB = require('../config/db');

const XrpTxLog = require("../models/XrpTxLog"); // your existing model


// ----------------------------- CONFIG ----------------------------------
const XRPL_RPC_URL = 'https://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7';
const MAX_TX_PER_ACCOUNT = 5000;
const CONCURRENT_ADDR_LIMIT = 3;
const MAX_REQ_PER_SECOND = 80;


const OUR_DEPOSIT_DESTS = [
"rwksm3hWyt2Ehm8RpoPSv7JAm6NqdMUpAg",
"rPhPjbCybVNBN1aJHoh3eNzAQq7csE8aoW",
"rEkcGq5nn78GapTCEyCa4UXkP1wMrbgFnN",
"rfR7jnw1DvLAVsqkr8SrhAy1Dbfmr6L1V2",
"r9519ztUDzZUTgZWdsMoNW5EBCJbga2pg6",
"rhDtxdRJYveUMnhmq1oe3Yt7oVDLYki2Gx",
"rPurkW6k23SEHPi7SDMcM5MyGE2oWf4jhG",
"rHwnssBeUo8G5AusLJn9aSK32L1oSddiym",
"r9519ztUDzZUTgZWdsMoNW5EBCJbga2pg6",
"rh2FJDvJE2c7Jh7d5sq1UbFHfKbvvqQpqx",
"rn8c19jkS2e3yUk8BnXUfNVbvEyTfF6iKa",
  // "rPaMYNQ4FFwfERQGDGuHddEbET62dNcmS7",
  // "rJRvvbvW4s5mMHvr9Uvby3RK3kNtCLeZMf",
  // "rMS5A2QSqsnnUMxMRsoRdw6VufZuj8c9s",
  // "rpSHvD5r68QiSgw4fe8YQo2umDhdSHDvrR",
  // "rhum8ge6s7HEzD6aruhXQVcu7RiiUTcyq6",
  // "rWw76Jfpb1vJYdVmE1xtwihNvnThhfYox",
  // "rLxpFXRRZNHcRstwPuVKc2bKF1xwygJXHi",
  // "rMYmdQ3TYnYcVAgbGgY9hXNaNFHdtZyNLy",
  // "rExcJsPHdvBLYxrdDQbdycBAUSX5hkKoQL",
  // "rspn86WVaiukD2K34E2emi7bQyHWMFKqNk",
  // "rPDXV2m9HA7hqi8PqhFoGn4JfTeUAvHbL3",
  // "rMcPmaHy6vRYxrxCRcg8G4JLout6C93HK3",
  // "rKHFUy7FE3pSajAcrMj7L6LEvCriNGgnUj",
  // "rZf2cv2TRes2jmeE1v8QhZZf7yBsTmYmY",
  // "rE9qrrPgkZgTroMVwmXHFatyMszdw4xK4G",
  // "rDkv6ZSjuyf3ec91qdSDQhomkwhwZTajGf",
  // 'rpm1UCxixbtDsergFWNDA2pdhz4R1ooVNQ',
  // 'r3JaSKsYhXNmFYDhpJzetsSjDjJMAEAsMm',
  // 'rE6o6cmu39zfrYp47vp1MuTBWwvGU7mXe9',
  // 'r47ADkBED6LT9UQypUBBn4kxeVHq5PyXkX',
  // 'rBJkbrYpUB9vhn5UhzaEFmcNwX8ho2nwi8',
  // 'rMabpPf24wmJNNfCiVNLLkxKRraoaKD6oS',
  // "rskHodMnSoRgrXis54bJcitKeQRVQowDQH",
  "rGPty1yQisw4z5soKZauz1Dc3xzeoyoMe3",
  // "r9TedDFitbyGzxP38yeT5c4CLxLvTPew5",
  // "rLxMPwZHCcuNZ9jTTJy9S8uq7Q6uHs97Bj",
];

const OUR_WITHDRAWAL_SOURCES = [
  // 'rfi4T2eHcjH4tTkJZ7izMu3TQFbckqY84M',
  // 'raEjhzmvKmmRpPxTxKPrVte66PAF7WVLt6',
  // 'rE6o6cmu39zfrYp47vp1MuTBWwvGU7mXe9',
  // 'rBJkbrYpUB9vhn5UhzaEFmcNwX8ho2nwi8',
  // 'rJhNaxHJyvSnzMoR5dY9iDmfAFJ8MgHoAR',
  // 'rNPKpFhDnr8Pevrv8xp1tRP1vKyaKop3Y9',
  // 'rMMcamAfe1EmgeRqEtiHs8dDMicvsLt46g',
    "rGPty1yQisw4z5soKZauz1Dc3xzeoyoMe3",
//   'rGTz2gXzfrueMmKuWhtReEUUAcgkbVPa1A',
//   'rSUm835nB4FELVf8m8gc2Pu8kVyT6Tz23',
//  "rMMcamAfe1EmgeRqEtiHs8dDMicvsLt46g",
//   "rBQneYtm9CMdGEKCuKZus2w5bwQDNhvg5X",
//   "rnPf6LsanYDsdKLAcP881raMoGx2Txjofn",
//   "rho2nWwgeAQMikSwRw2yWy8nDzg7KE5MnB",
//   "rH6PayPzYwBTJRYsVYHZUPyBSBspzA4ioo",
//   "rwP8XLSMnb6w1qQ3ATGevLra6UFcG6yo5w",
//   "rUrKZFqEoPXEhSBnCaMkjKRAGK6ZYSJCbg",
//   "rDQJjmRurYS7CWYuiYbfJxXdX6i7U9wRFq",
//   "racqxkkswvu1ppzu75hKbUi2baYBdTZLxe",
    "rGz9b8um4jVL5S4RP7Uvwej2D2dGGzowh",
    "rn5RiVQLZyE7TMTy68gVFF5HN8Qc2Pzf5b",
    "rw9Dta7f3VEghQmRXmgfPAbS8QGXpPK43W",
    "rJAVCMtwrjQTbkKMdoGCKJT3wLGc9hhByC",
    "ryxdd57ADJCrkMXffTBkALZYX33FJhMhi",
    "rNfsD8kRgZ5y3F5PkfxCMpgKKzX9eFWaAB",
"rUM4sBip3mq1exNSkAa1L7LuExc1d67xgB",
"rMaWxDUNGeCxCBW5reh491XQyjqeS3nmrE",
"rK25WEDw4xE1pH3aqS75gAcakZLJ622BkB",
"rhape1GpxNi7kaRG4gDV7Xe1egcLqzMDjJ"
];

// ----------------------------- AUTO-UPDATE WITHDRAWAL SOURCES -----------------------------
async function updateWithdrawalSources() {
  try {
    // Fetch all distinct source accounts from previous XRP logs
    const newAccounts = await XrpTxLog.distinct("response.quicknode.tx_json.Account");

    console.log("🌿 Found new XRPL source accounts from xrp_tx_logs:", newAccounts.length);

    // Merge old + new, remove duplicates
    const updatedSources = Array.from(new Set([...OUR_WITHDRAWAL_SOURCES, ...newAccounts]));

    OUR_WITHDRAWAL_SOURCES.length = 0; // Clear old array
    OUR_WITHDRAWAL_SOURCES.push(...updatedSources); // Repopulate

    console.log("✅ Updated OUR_WITHDRAWAL_SOURCES count:", OUR_WITHDRAWAL_SOURCES.length);
  } catch (error) {
    console.error("❌ Error updating withdrawal sources:", error);
  }
}


// ----------------------------- MODELS ----------------------------------
const User = require('../models/User');
const { Schema } = mongoose;

const txFields = {
  txHash: { type: String, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  uhid: String,
  amountXRP: Number,
  source: String,
  destination: String,
  ledgerIndex: Number,
  txDate: Date,
  raw: Schema.Types.Mixed,
};

const Deposit = mongoose.model('ChainDeposit', new Schema(txFields), 'cDeposits');
const Withdrawal = mongoose.model('ChainWithdrawal', new Schema(txFields), 'cWithdrawals');

// ----------------------------- HELPERS ----------------------------------
function rippleTimeToDate(rippleSeconds) {
  return new Date((rippleSeconds + 946684800) * 1000);
}

// ---- Rate limiter ----
function createRateLimiter(maxPerInterval, intervalMs) {
  let tokens = maxPerInterval;
  const queue = [];
  const addTokenInterval = intervalMs / maxPerInterval;

  setInterval(() => {
    if (tokens < maxPerInterval) tokens++;
    if (tokens > 0 && queue.length) {
      tokens--;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve(fn()).then(resolve).catch(reject);
    }
  }, addTokenInterval);

  return (fn) =>
    new Promise((resolve, reject) => {
      if (tokens > 0) {
        tokens--;
        Promise.resolve(fn()).then(resolve).catch(reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
}
const rateLimit = createRateLimiter(MAX_REQ_PER_SECOND, 1000);

async function rateLimitedPost(body, attempt = 0) {
  try {
    return await rateLimit(() =>
      axios.post(XRPL_RPC_URL, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      })
    );
  } catch (err) {
    if (err.response?.status === 429 && attempt < 5) {
      const waitMs = 1000 * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, waitMs));
      return rateLimitedPost(body, attempt + 1);
    }
    throw err;
  }
}

async function fetchAccountTx(address) {
  let marker = null;
  const allTx = [];

  do {
    const body = {
      method: 'account_tx',
      params: [{
        account: address,
        binary: false,
        forward: false,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: MAX_TX_PER_ACCOUNT,
        ...(marker ? { marker } : {}),
      }],
      id: 1,
      jsonrpc: '2.0',
    };

    const { data } = await rateLimitedPost(body);
    if (data.error) throw new Error(`XRPL error: ${data.error}`);
    const result = data.result;
    if (!result || !result.transactions) break;

    allTx.push(...result.transactions);
    marker = result.marker || null;
  } while (marker);

  return allTx;
}

function classifyTx(tx, userAddr) {
  const source = tx.tx.Account;
  const destination = tx.tx.Destination;
  const delivered = tx.meta?.delivered_amount ?? tx.meta?.DeliveredAmount ?? tx.tx?.Amount;
  if (delivered == null) return null;

  let dropsString;
  if (typeof delivered === 'string') {
    dropsString = delivered;
  } else if (typeof delivered === 'object') {
    if ((delivered.currency && delivered.currency !== 'XRP') || delivered.value == null) return null;
    dropsString = delivered.value;
  } else return null;

  const dropsNum = Number(dropsString);
  if (Number.isNaN(dropsNum)) return null;

  const amountXRP = dropsNum / 1_000_000;

  if (source === userAddr && OUR_DEPOSIT_DESTS.includes(destination)) {
    return { kind: 'deposit', amountXRP, source, destination };
  }
  if (OUR_WITHDRAWAL_SOURCES.includes(source)) {
    return { kind: 'withdrawal', amountXRP, source, destination };
  }
  return null;
}

// ---- Concurrency limiter ----
function pLimit(concurrency) {
  const queue = [];
  let activeCount = 0;
  const next = () => {
    if (!queue.length || activeCount >= concurrency) return;
    activeCount++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve(fn())
      .then(resolve, reject)
      .finally(() => {
        activeCount--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
const limit = pLimit(CONCURRENT_ADDR_LIMIT);

// ----------------------------- MAIN ----------------------------------
(async function main() {
  try {
    await connectDB();
    await updateWithdrawalSources();

    await Promise.all([
      Deposit.collection.createIndex({ txHash: 1 }, { unique: true }),
      Withdrawal.collection.createIndex({ txHash: 1 }, { unique: true }),
    ]);

    const target = process.argv[2];
    let isXrpAddress = false;

    if (target && /^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(target)) {
      isXrpAddress = true;
      console.log('→ Single XRP address mode:', target);
    }

  let query = {};
if (target && isXrpAddress) {
  // Only this address
  query = { xrpAddress: target };
} else {
  // All users with XRP address
  query = { xrpAddress: { $exists: true, $ne: '' } };
}

const users = await User.find(query)
  .select('_id uhid xrpAddress')
  .lean();

    console.log(`→ Found ${users.length} XRP addresses`);

    let processed = 0;
    await Promise.all(
      users.map((user) =>
        limit(async () => {
          try {
            console.log(`[${++processed}/${users.length}] Fetching tx for`, user.xrpAddress);
            const txs = await fetchAccountTx(user.xrpAddress);

            for (const item of txs) {
              const cls = classifyTx(item, user.xrpAddress);
              if (!cls) continue;

              const doc = {
                txHash: item.tx.hash,
                userId: user._id,
                uhid: user.uhid,
                amountXRP: cls.amountXRP,
                source: cls.source,
                destination: cls.destination,
                ledgerIndex: item.tx.ledger_index,
                txDate: rippleTimeToDate(item.tx.date),
                raw: item,
              };

              if (cls.kind === 'deposit') {
                const existing = await Deposit.findOne({ txHash: doc.txHash });
                if (!existing) {
                  await Deposit.create(doc);
                  console.log(`💾 Created deposit row for ${doc.txHash}`);
                }
              } else if (cls.kind === 'withdrawal') {
                const existing = await Withdrawal.findOne({ txHash: doc.txHash });
                if (!existing) {
                  await Withdrawal.create(doc);
                  console.log(`💾 Created withdrawal row for ${doc.txHash}`);
                }
              }
            }
          } catch (err) {
            console.error('⚠️ Error processing address', user.xrpAddress, err.message);
          }
        })
      )
    );

    console.log('✅ Done.');
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
