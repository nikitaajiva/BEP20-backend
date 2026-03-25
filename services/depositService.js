const User = require('../models/User');
const XrpDeposit = require('../models/XrpDeposit');
const LedgerRow = require('../models/LedgerRow');
const Ledger = require('../models/Ledger');
const xrpl = require('xrpl');
const mongoose = require('mongoose');
const { addDecimal128 } = require('../utils/decimal128Utils');
const { getOrCreateLedger, createLedgerEntry } = require('../jobs/helpers/ledgerHelpers');

const XRP_LEDGER_SERVER = process.env.XRP_LEDGER_SERVER_URL || 'wss://neat-responsive-energy.xrp-mainnet.quiknode.pro/45f3ff38aac25053f6b316235305d0cefacb68e7';
const SYSTEM_DEPOSIT_WALLET = process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS;

async function getXrplClient() {
    const client = new xrpl.Client(XRP_LEDGER_SERVER);
    await client.connect();
    return client;
}

/**
 * Processes a single XRP transaction by its ID.
 * This is the core logic that can be used by both the real-time endpoint and the poller.
 * @param {string} transactionId - The transaction hash.
 * @param {string} userWalletAddress - The expected destination wallet address from the user's profile.
 * @returns {object} An object indicating the result of the processing.
 */
async function processXrpTransaction(transactionId, userWalletAddress) {
  // ✅ Static array of valid system deposit addresses
  const SYSTEM_DEPOSIT_ADDRESSES = [
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

    "rWw76Jfpb1vJYdVmE1xtwihNvnThhfYox",
    "rskHodMnSoRgrXis54bJcitKeQRVQowDQH",
    "rGPty1yQisw4z5soKZauz1Dc3xzeoyoMe3",
    "r9TedDFitbyGzxP38yeT5c4CLxLvTPew5",
    "rLxMPwZHCcuNZ9jTTJy9S8uq7Q6uHs97Bj",
    "rPaMYNQ4FFwfERQGDGuHddEbET62dNcmS7",
    "rJRvvbvW4s5mMHvr9Uvby3RK3kNtCLeZMf",
    "rMS5A2QSqsnnUMxMRsoRdw6VufZuj8c9s",
    "rpSHvD5r68QiSgw4fe8YQo2umDhdSHDvrR",
    "rhum8ge6s7HEzD6aruhXQVcu7RiiUTcyq6",
      "rLxpFXRRZNHcRstwPuVKc2bKF1xwygJXHi",
  "rMYmdQ3TYnYcVAgbGgY9hXNaNFHdtZyNLy",
  "rExcJsPHdvBLYxrdDQbdycBAUSX5hkKoQL",
  "rspn86WVaiukD2K34E2emi7bQyHWMFKqNk",
  "rPDXV2m9HA7hqi8PqhFoGn4JfTeUAvHbL3",
  "rMcPmaHy6vRYxrxCRcg8G4JLout6C93HK3",
  "rKHFUy7FE3pSajAcrMj7L6LEvCriNGgnUj",
  "rZf2cv2TRes2jmeE1v8QhZZf7yBsTmYmY",
  "rE9qrrPgkZgTroMVwmXHFatyMszdw4xK4G",
  "rDkv6ZSjuyf3ec91qdSDQhomkwhwZTajGf",
  ];

  // 🧠 Optional fallback: add .env address if needed
  if (process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS && 
      !SYSTEM_DEPOSIT_ADDRESSES.includes(process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS)) {
    SYSTEM_DEPOSIT_ADDRESSES.push(process.env.SYSTEM_DEPOSIT_WALLET_ADDRESS);
  }

  // 🔒 Prevent duplicate transactions
  const existingLedgerRow = await LedgerRow.findOne({ refId: transactionId, eventType: 'DEPOSIT' });
  if (existingLedgerRow) {
    return {
      success: false,
      status: 'duplicate',
      message: `Transaction ID ${transactionId} has already been recorded in the ledger.`
    };
  }

  const existingDeposit = await XrpDeposit.findOne({ transactionId });
  if (existingDeposit) {
    return {
      success: false,
      status: 'duplicate',
      message: `Transaction ID ${transactionId} already recorded (status: ${existingDeposit.status}).`
    };
  }

  const user = await User.findOne({ xrpAddress: userWalletAddress });
  if (!user) {
    return {
      success: false,
      status: 'no_user',
      message: `No user found with the XRP address: ${userWalletAddress}`
    };
  }

  const authenticatedUserId = user._id;
  let client;
  let newDeposit;

  try {
    newDeposit = new XrpDeposit({
      user: authenticatedUserId,
      walletAddress: userWalletAddress,
      transactionId,
      amount: '0',
      status: 'pending_verification',
      ledgerTimestamp: new Date()
    });
    await newDeposit.save();

    client = await getXrplClient();
    const response = await client.request({
      command: 'tx',
      transaction: transactionId,
      binary: false
    });

    const txData = response.result;
    if (!txData) {
      const errorMessage = `Could not find transaction data in XRPL response for tx: ${transactionId}`;
      console.error(`[DEPOSIT_VALIDATION_FAIL] ${errorMessage}`, response);
      newDeposit.status = 'failed';
      newDeposit.processingError = errorMessage;
      await newDeposit.save();
      return { success: false, status: 'validation_failed', message: errorMessage };
    }

    if (!txData.validated || txData.meta?.TransactionResult !== 'tesSUCCESS') {
      newDeposit.status = 'failed';
      newDeposit.processingError = `Transaction not successful or not validated. Result: ${txData.meta?.TransactionResult || 'N/A'}`;
      await newDeposit.save();
      return { success: false, status: 'validation_failed', message: newDeposit.processingError };
    }

    if (!txData.tx_json) {
      newDeposit.status = 'failed';
      newDeposit.processingError = 'Transaction data (tx_json) is missing in XRPL response.';
      await newDeposit.save();
      return { success: false, status: 'validation_failed', message: newDeposit.processingError };
    }

    // ✅ 🔍 Check transaction type + destination among static addresses
    const txDest = txData.tx_json.Destination;
    const txType = txData.tx_json.TransactionType;
    const txSender = txData.tx_json.Account;

    const isSystemDeposit = SYSTEM_DEPOSIT_ADDRESSES.some(
      addr => addr.trim().toLowerCase() === txDest.trim().toLowerCase()
    );

    if (txType !== 'Payment' || !isSystemDeposit || txSender !== userWalletAddress) {
      newDeposit.status = 'failed';
      newDeposit.processingError = `Transaction validation failed. Type: ${txType}, Dest: ${txDest}, Sender: ${txSender}`;
      await newDeposit.save();
      return { success: false, status: 'validation_failed', message: newDeposit.processingError };
    }

    // ✅ Validate amount
    if (!txData.meta || typeof txData.meta.delivered_amount !== 'string') {
      newDeposit.status = 'failed';
      const errorDetail = txData.meta
        ? `unexpected type for delivered_amount: ${typeof txData.meta.delivered_amount}`
        : 'meta object missing or malformed.';
      newDeposit.processingError = `Invalid or missing delivered_amount. Details: ${errorDetail}`;
      await newDeposit.save();
      return { success: false, status: 'amount_error', message: newDeposit.processingError };
    }

    const amountInDrops = txData.meta.delivered_amount;
    const amountXRP = parseFloat(amountInDrops) / 1000000;
    const ledgerTimestamp = txData.date ? new Date(xrpl.rippleTimeToISOTime(txData.date)) : new Date();

    // ✅ Save deposit
    newDeposit.amount = amountInDrops;
    newDeposit.status = 'completed';
    newDeposit.ledgerTimestamp = ledgerTimestamp;
    if (txData.tx_json.DestinationTag !== undefined) {
      newDeposit.destinationTag = txData.tx_json.DestinationTag;
    }
    newDeposit.processingError = null;

    // ✅ Update user + ledger balances
    if (!user.xrpAddress) user.xrpAddress = userWalletAddress;
    user.xamanBalance = (user.xamanBalance || 0) + amountXRP;
    await user.save();

    const ledger = await getOrCreateLedger(authenticatedUserId);
    const depositAmountD128 = mongoose.Types.Decimal128.fromString(amountXRP.toString());

    console.log(`[DEPOSIT_DEBUG] User: ${authenticatedUserId}`);
    console.log(`[DEPOSIT_DEBUG] Before Update: ${ledger.wallets.xaman.toString()}`);
    console.log(`[DEPOSIT_DEBUG] Amount to add: ${depositAmountD128.toString()}`);

    ledger.wallets.xaman = addDecimal128(ledger.wallets.xaman, depositAmountD128);
    ledger.wallets.zeroRisk = addDecimal128(ledger.wallets.zeroRisk, depositAmountD128);
    ledger.wallets.zeroRiskIpfs = addDecimal128(ledger.wallets.zeroRiskIpfs, depositAmountD128);
    ledger.markModified('wallets');
    await ledger.save();
    await newDeposit.save();

    await createLedgerEntry({
      userId: authenticatedUserId,
      eventType: 'DEPOSIT',
      amount: depositAmountD128.toString(),
      walletFrom: 'EXTERNAL',
      walletTo: 'XAMAN',
      narrative: `Xaman wallet deposit. TxHash: ${transactionId}`,
      refId: transactionId
    });

    return {
      success: true,
      status: 'completed',
      message: 'XRP deposit recorded and added to Xaman wallet.',
      deposit: newDeposit,
      xamanWalletBalance: amountXRP,
    };

  } catch (error) {
    console.error(`Error processing XRP transaction ${transactionId}:`, error);
    if (newDeposit && newDeposit._id) {
      await XrpDeposit.updateOne(
        { _id: newDeposit._id },
        { status: 'failed', processingError: error.message || 'Unexpected error.' }
      );
    }
    return { success: false, status: 'error', message: 'Server error processing deposit.', error: error.message };
  } finally {
    if (client && client.isConnected()) await client.disconnect();
  }
}

module.exports = {
    processXrpTransaction,
    getXrplClient
}; 