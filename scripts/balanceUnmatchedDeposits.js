const dotenv = require('dotenv');
// Load env early so db config picks it up (if provided)
dotenv.config();

const mongoose   = require('mongoose');
const connectDB  = require('../config/db');

// --- Models -------------------------------------------------------------
// Re-use existing chain deposit/withdrawal schemas so we bind to the same
// collections as other scripts & the API.
const ChainDeposit    = require('../models/ChainDeposit');    // cDeposits
const ChainWithdrawal = require('../models/ChainWithdrawal'); // cWithdrawals
const LedgerRow       = require('../models/LedgerRow');       // ledgerrows

// -----------------------------------------------------------------------
// CLI flag parsing – default is DRY-RUN, use --apply to write to DB.
const APPLY_CHANGES = process.argv.includes('--apply') ||
                      process.argv.includes('--execute');



(async function main() {
  try {
    // 1. Connect to MongoDB (uses hard-coded URI if .env absent)
    await connectDB();

    // 2. Build aggregation pipeline to fetch deposits that have *no* matching
    //    ledger row (eventType DEPOSIT, EXTERNAL → XAMAN) where txHash === refId.
    const unmatchedDeposits = await ChainDeposit.aggregate([
      {
        $lookup: {
          from: 'ledgerrows',
          let: { hash: '$txHash' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$refId', '$$hash'] },
                    { $eq: ['$eventType', 'DEPOSIT'] },
                    { $eq: ['$walletFrom', 'EXTERNAL'] },
                    { $eq: ['$walletTo', 'XAMAN'] },
                  ],
                },
              },
            },
          ],
          as: 'ledgerMatch',
        },
      },
      { $match: { ledgerMatch: { $size: 0 } } },
      { $sort: { uhid: 1 } }, // sort by uhid ascending
    ]).exec();

    

    if (!APPLY_CHANGES) {
      // Dry-run – list every unmatched deposit ordered by uhid
      unmatchedDeposits.forEach((d, idx) => {
        
      });
      
      return;
    }

    // 3. APPLY MODE – create matching withdrawals
    const bulkOps = unmatchedDeposits.map((dep) => ({
      insertOne: {
        document: {
          txHash: `BAL_${dep.txHash}`,
          userId: dep.userId,
          uhid: dep.uhid,
          amountXRP: dep.amountXRP,
          source: dep.destination,     // reverse direction (funds move out)
          destination: dep.source,
          ledgerIndex: dep.ledgerIndex,
          txDate: dep.txDate || new Date(),
          raw: { generatedBy: 'balanceUnmatchedDeposits' },
        },
      },
    }));

    if (bulkOps.length === 0) {
      
      return;
    }

    const result = await ChainWithdrawal.bulkWrite(bulkOps, { ordered: false });
    
  } catch (err) {
    console.error('❌  Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})(); 
