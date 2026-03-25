// This script updates the swift wallet balance in the ledgers collection
// using the airdrop_wallet value from the userWalletBalance collection.

const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');

// Since there is no formal model for userWalletBalance, we define a lightweight
// schema here to read the necessary data.
const userWalletBalanceSchema = new mongoose.Schema({
  uhid: String,
  airdrop_wallet: String
}, { collection: 'userWalletBalance' }); // Explicitly set the collection name

const UserWalletBalance = mongoose.model('UserWalletBalance', userWalletBalanceSchema);

const updateSwiftWallets = async () => {
  const dbURI = 'mongodb://localhost:27017/xrpmigrate';
  console.log(`Connecting to the database at ${dbURI}...`);
  
  try {
    await mongoose.connect(dbURI);
    console.log('Database connected successfully.');

    console.log('Fetching all documents from userWalletBalance collection...');
    const walletBalances = await UserWalletBalance.find({}).lean();

    if (walletBalances.length === 0) {
      console.log('No documents found in userWalletBalance. No updates to perform.');
      return;
    }

    console.log(`Found ${walletBalances.length} wallet balance entries. Preparing bulk update...`);

    // Prepare the bulk write operations for efficiency.
    const bulkOps = walletBalances.map(balance => {
      // Ensure there's a uhid and a valid airdrop_wallet value before creating an update operation.
      if (!balance.uhid || typeof balance.airdrop_wallet !== 'string') {
        console.warn(`Skipping entry with uhid ${balance.uhid} due to missing or invalid airdrop_wallet.`);
        return null;
      }
      if (balance.uhid === '17469855250636') {
      console.log(`Updating ledger for uhid: ${balance.uhid} with airdrop_wallet: ${balance.airdrop_wallet}`);
      }
      return {
        updateOne: {
          filter: { uhid: balance.uhid },
          update: {
            $set: {
              'wallets.swift': mongoose.Types.Decimal128.fromString(balance.airdrop_wallet)
            }
          }
        }
      };
    }).filter(op => op !== null); // Filter out any null operations from skipped entries

    if (bulkOps.length > 0) {
      console.log(`Executing bulk update for ${bulkOps.length} ledgers...`);
      const result = await Ledger.bulkWrite(bulkOps);
      console.log('Bulk update finished.');
      console.log(`Successfully matched ${result.matchedCount} ledgers and modified ${result.modifiedCount}.`);
    } else {
      console.log('No valid update operations to perform.');
    }

  } catch (error) {
    console.error('An unexpected error occurred during the script execution:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
};

// Run the script
updateSwiftWallets(); 