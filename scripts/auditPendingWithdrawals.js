/*
  Audit Pending Withdrawals Script
  --------------------------------
  For every ledger where `withdrawalDisabled=true` and a `pendingWithdrawal` exists, this script:
    1. Computes on-chain deposits & withdrawals (collections `cDeposits` / `cWithdrawals`).
    2. Calculates an expected LP balance using the formula:
         expectedLP = (onchainDeposits * 5)  // 5-X earning potential
                      - onchainWithdrawals
                      - communityRewards
                      - xaman

       NOTE: If your definition of “5X” differs, adjust the multiplier below.

    3. Compares the expected LP to the actual LP wallet. If the actual LP is lower and the
       shortfall ≈ pendingWithdrawal.amount, we flag the ledger as NEEDS_REFUND. Otherwise we
       assume the withdrawal succeeded (or mismatch is within tolerance).

  Run with:  node backend/scripts/auditPendingWithdrawals.js   [--dry]
*/

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Ledger = require('../models/Ledger');
const { addDecimal128 } = require('../utils/decimal128Utils');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create a writable stream that appends to the log file
const logFilePath = path.join(logsDir, 'pendingWithdrawals.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });


function log(message, writeToFile = true) {
  const timestamp = new Date().toISOString(); // UTC timestamp
  const fullMessage = `[${timestamp}] ${message}`;

  

  if (writeToFile) {
    logStream.write(fullMessage + '\n');
  }
}
const { Schema } = mongoose;
const txFields = { amountXRP: Number, userId: { type: Schema.Types.ObjectId, ref: 'User' } };
const Deposit = mongoose.model('TmpChainDeposit', new Schema(txFields), 'cDeposits');
const Withdrawal = mongoose.model('TmpChainWithdrawal', new Schema(txFields), 'cWithdrawals');

const MULTIPLIER_5X = 5; // change if your 5× definition is different
const TOL = 0.001;    // tolerance for float comparisons (in XRP)
const isDryRun = process.argv.includes('--dry');

function d2n(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(val.toString());
}

(async function main() {
  try {
    await connectDB();

    const ledgers = await Ledger.find({ withdrawalDisabled: true}).lean();
    

    let needsRefund = 0;
    let alreadyPaid = 0;
    let withdrawalsMatched = 0;
    let unMatchedWithdrawals = {}
    let refundsProcessed = 0;
    for (const lg of ledgers) {
      const userId = lg._id;
    
      // Aggregate on-chain deposits & withdrawals
      const [depAgg] = await Deposit.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: '$amountXRP' } } },
      ]);
      const [withAgg] = await Withdrawal.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: '$amountXRP' } } },
      ]);

      const deposits = d2n(depAgg?.total);
      const withdrawals = d2n(withAgg?.total);

      const communityRewards = d2n(lg.wallets?.communityRewards);
      const xaman = d2n(lg.wallets?.xaman);
      const lp = d2n(lg.wallets?.lp);
      const fiveX = d2n(lg.limits.fiveXLimit.used);
      const expectedLP = deposits + fiveX - withdrawals - communityRewards - xaman;
      const diff = expectedLP - lp; // positive diff means there had been unrecorded withdrawals
      const errLog = await mongoose.connection.collection('withdrawalerrorlogs')
      .find({ userId })
      .project({ amount: 1 })  // Only need the amount
      .sort({ _id: -1 })       // Latest entry first
      .limit(1)
      .toArray();


    /* if found diff then add it to user communityRewards and update the user  */
    // if(diff > 0 && lg.uhid == 17481857045649 ){
    //   //&& lg.uhid == 17481857045649 
    //     const userledger = await Ledger.findById(userId);
    //     userledger.wallets.communityRewards = communityRewards + diff;
    //     
    //     // await userledger.save();
    // }
    

    const pendingAmt = d2n(errLog[0]?.amount);
       
    /* if pendingAmt is greater then 0 then and update the user  */
    if(pendingAmt > 0 ){
      //&& lg.uhid == 17481857045649 
        const userledger = await Ledger.findById(userId);
        userledger.withdrawalDisabled = false;
        userledger.pendingWithdrawal = null;
        log(`pendingAmt value ${pendingAmt}> Needs to be adjusted ${lg.uhid} `,  true);
        
        // await userledger.save();
    }
      
      let verdict;
      if (diff > TOL && Math.abs(diff - pendingAmt) < TOL) {
         
        verdict = 'NEEDS_REFUND';
        needsRefund++;
        if (!isDryRun) {
          try {
            const ledgerDoc = await Ledger.findById(userId);
            if (ledgerDoc) {
              const refundDecimal = mongoose.Types.Decimal128.fromString(pendingAmt.toString());
              ledgerDoc.wallets.lp = addDecimal128(ledgerDoc.wallets.lp || '0.0', refundDecimal);
              ledgerDoc.withdrawalDisabled = false;
              ledgerDoc.pendingWithdrawal = undefined;
              await ledgerDoc.save();
              refundsProcessed++;
              
            }
          } catch (refundErr) {
            console.error('Failed to process refund for', userId, refundErr);
          }
        } else {
          refundsProcessed++;
          
        }
      } else {
        verdict = 'ALREADY_PAID_OR_MISMATCH';
        const exactMatch = await Withdrawal.findOne({
          userId,
          amountXRP: pendingAmt,
        });
    
        if (exactMatch) {
          
          withdrawalsMatched++;
          if (!isDryRun) {
            try {
              const ledgerDoc = await Ledger.findById(userId);
              if (ledgerDoc) {
                ledgerDoc.withdrawalDisabled = false;
                ledgerDoc.pendingWithdrawal = undefined;
                await ledgerDoc.save();
                
              }
            } catch (releaseErr) {
              console.error('Failed to release withdrawal lock for', userId, releaseErr);
            }
          } else {
            
          }
        }
        else {
          const withdrawals = await Withdrawal.find({ userId }).lean();
          

          const totalWithdrawals = withdrawals.reduce((sum, w) => {
            
            return sum + d2n(w.amountXRP);
          }, 0);
          
          unMatchedWithdrawals[userId] = { pendingAmt: withdrawals };
        }
        alreadyPaid++;
      }

      if (verdict === 'ALREADY_PAID_OR_MISMATCH') {
        console.log(
          `AR=${communityRewards.toFixed(6)} | lp=${lp.toFixed(6)} | ` +
          `expectedLP=${expectedLP.toFixed(6)} | diff=${diff.toFixed(6)} | ` +
          `pending=${pendingAmt.toFixed(6)} | ${verdict}`
        );
      }
    }

    
    
    
    
    

  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
