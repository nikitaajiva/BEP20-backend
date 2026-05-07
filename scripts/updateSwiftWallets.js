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
  
  
  try {
    await mongoose.connect(dbURI);
    

    
    const walletBalances = await UserWalletBalance.find({}).lean();

    if (walletBalances.length === 0) {
      
      return;
    }

    

    // Deduplicate based on uhid, keeping the first-seen entry.
    const uniqueWalletBalances = new Map();
    walletBalances.forEach(balance => { 
        if (balance.uhid) { // Only process if uhid exists
            if (!uniqueWalletBalances.has(balance.uhid)) {
                uniqueWalletBalances.set(balance.uhid, balance);
            }
        } else {
            console.warn('Found an entry with a missing uhid. Skipping.');
        }
    });

    

    // Prepare the bulk write operations for efficiency.
    const bulkOps = Array.from(uniqueWalletBalances.values()).map(balance => {
      // Ensure there's a uhid and a valid airdrop_wallet value before creating an update operation.
      if (!balance.uhid || typeof balance.airdrop_wallet !== 'string' || isNaN(parseFloat(balance.airdrop_wallet))) {
        console.warn(`Skipping entry with uhid ${balance.uhid} due to missing uhid or invalid airdrop_wallet: ${balance.airdrop_wallet}.`);
        return null;
      }
      if (balance.uhid === '17469855250636') {
        
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
      
      const result = await Ledger.bulkWrite(bulkOps);
      
      
    } else {
      
    }

  } catch (error) {
    console.error('An unexpected error occurred during the script execution:', error);
  } finally {
    await mongoose.disconnect();
    
  }
};

// Run the script
updateSwiftWallets(); 
