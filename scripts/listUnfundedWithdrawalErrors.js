/**
 * List unfunded withdrawal errors (tecUNFUNDED_PAYMENT)
 *
 * Usage:
 *   node scripts/listUnfundedWithdrawalErrors.js                  # today (UTC)
 *   node scripts/listUnfundedWithdrawalErrors.js --limit=200
 *   node scripts/listUnfundedWithdrawalErrors.js --days=3         # last 3 days
 *   node scripts/listUnfundedWithdrawalErrors.js --since=2025-08-13T00:00:00Z --until=2025-08-15T00:00:00Z
 *   node scripts/listUnfundedWithdrawalErrors.js --user=6896358a81f21435e1c888be
 *   node scripts/listUnfundedWithdrawalErrors.js --regex="tecUNFUNDED_PAYMENT|notSynced"
 *   node scripts/listUnfundedWithdrawalErrors.js --all            # ignore date filter
 *
 * Output:
 *   - Console table (top N)
 *   - CSV:   ./unfunded_withdrawals_<timestamp>.csv
 *   - JSON:  ./unfunded_withdrawals_<timestamp>.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const util = require('util');

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const xrpTransactions = require("../utils/xrpTransactions");
// --- 🔄 Track Chain TX Integration ---
const { spawn } = require('child_process');
const trackChainScript = path.join(__dirname, 'trackChainTx.js');

function callTrackChainTx(xrpAddress) {
  try {
    if (!xrpAddress) {
      
      return;
    }

    const child = spawn('node', [trackChainScript, xrpAddress], {
      stdio: 'ignore',
      detached: true,
    });

    // Event handlers
    child.on('error', (error) => {
      
    });

    child.on('exit', (code) => {
      if (code === 0) {
        
      } else {
        
      }
    });

    
    return child;
  } catch (error) {
    
  }
}


const args = process.argv.slice(2);
const flag = (k, def) => {
  const a = args.find(x => x.startsWith(`--${k}=`));
  if (!a) return def;
  const v = a.split('=').slice(1).join('=');
  return v;
};
const has = k => args.includes(`--${k}`) || args.includes(`-${k}`);

const LIMIT = Number(flag('limit', '15')) || 15;
const DAYS = Number(flag('days', '0')) || 0;
const SINCE = flag('since', null);
const UNTIL = flag('until', null);
const ALL   = has('all');
const USER  = flag('user', null); // userId string
const REGEX = flag('regex', 'tecUNFUNDED_PAYMENT'); // error pattern

// Loose schema so we capture ALL fields from the collection
const WithdrawalErrorLog = mongoose.model(
  'WithdrawalErrorLog',
  new mongoose.Schema({}, { strict: false }),
  'withdrawalerrorlogs'
);

function utcTodayWindow() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  return { start: new Date(Date.UTC(y, m, d)), end: new Date(Date.UTC(y, m, d + 1)) };
}

function getWindow() {
  if (ALL) return { start: new Date(0), end: new Date('9999-12-31T00:00:00Z') };
  if (SINCE || UNTIL) {
    return {
      start: SINCE ? new Date(SINCE) : new Date(0),
      end: UNTIL ? new Date(UNTIL) : new Date()
    };
  }
  if (DAYS > 0) {
    const end = new Date();
    const start = new Date(end.getTime() - DAYS * 24 * 60 * 60 * 1000);
    return { start, end };
  }
  return utcTodayWindow(); // default: today in UTC
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toNum = (v) =>
  v == null ? 0 :
  typeof v === 'number' ? v :
  typeof v === 'string' ? Number(v) :
  (v && typeof v.toString === 'function') ? Number(v.toString()) : Number(v);

function pick(obj, pathStr, def = undefined) {
  try {
    return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) ?? def;
  } catch { return def; }
}

function deriveAmountXrp(doc) {
  // Prefer top-level amount (Decimal128) if present
  const top = toNum(doc.amount);
  if (top > 0) return top;

  // Fallback: from tx_json (drops)
  const amtDropsStr = pick(doc, 'xrpResponse.data.tx_json.Amount', null)
                   ?? pick(doc, 'xrpResponse.data.tx_json.DeliverMax', null);
  const drops = amtDropsStr ? Number(amtDropsStr) : 0;
  return drops / 1_000_000;
}

function deriveFeeXrp(doc) {
  const feeDropsStr = pick(doc, 'xrpResponse.data.tx_json.Fee', '0');
  const drops = Number(feeDropsStr || 0);
  return drops / 1_000_000;
}
async function updateWithNewTxHash({ errorLogId, ledgerRowId, newHash, amountXrp,destinationAddress }) {
  const ops = [];

  // Update the original error log row (so you can audit what was fixed)
  ops.push(
    WithdrawalErrorLog.updateOne(
      { _id: errorLogId },
      {
        $set: {
          errorCode: 'RESOLVED',
          errorMessage: `Retried: broadcasted new tx hash ${newHash}`,
          xrpResponse: `${newHash}`,
          stackTrace: `Retried: broadcasted new tx hash ${newHash}`,
        },
      }
    )
  );

  // Update the LedgerRow document (primary record of the withdrawal)
 if (ledgerRowId && mongoose.isValidObjectId(ledgerRowId)) {
  ops.push(
    LedgerRow.updateOne(
      { _id: new mongoose.Types.ObjectId(ledgerRowId) },
      {
        $set: {
          refId: newHash,
          narrative: `Community Rewards redeemed to ${destinationAddress}`,
          updatedAt: new Date(),
        },
      }
    )
  );
}

  await Promise.all(ops);
}


(async () => {
  await connectDB();

  const { start, end } = getWindow();
  const errorRegex = new RegExp(REGEX);
const RECORD_ID = flag('id', null);
  const match = {};

if (RECORD_ID) {
  // Only this record
  match._id = new mongoose.Types.ObjectId(RECORD_ID);
} else {
  match.createdAt = { $gte: start, $lt: end };
  match.$or = [
    { errorMessage: errorRegex },
    { 'xrpResponse.message': errorRegex },
    { stackTrace: errorRegex }
  ];
  if (USER) {
    match.userId = new mongoose.Types.ObjectId(USER);
  }
}


  

  const cursor = WithdrawalErrorLog.find(match, {}).sort({ createdAt: -1, _id: -1 }).limit(LIMIT);
  const docs = await cursor.lean();

  
  
  

  const rows = [];
  let totalAttempted = 0;
  let totalFees = 0;

    for (const [i, d] of docs.entries()) {
    const amountXRP = deriveAmountXrp(d);
    const feeXRP = deriveFeeXrp(d);
    totalAttempted += amountXRP;
    totalFees += feeXRP;

    const engine = pick(d, 'xrpResponse.data.meta.TransactionResult', pick(d, 'xrpResponse.data.outcome.result', null));
    const hash   = pick(d, 'xrpResponse.data.hash', pick(d, 'xrpResponse.data.tx_json.hash', null));
      const fixedAmount = Number(parseFloat(amountXRP).toFixed(6));
      let xrpTxHash = '';
      const txResult = await xrpTransactions.sendXRP(
            d.destinationAddress,
            fixedAmount,
            d.ledgerRowId
          );
          xrpTxHash = txResult.hash; 
           
  if (xrpTxHash) {
  try {
    await updateWithNewTxHash({
      errorLogId: d._id,
      ledgerRowId: d.ledgerRowId,
      newHash: xrpTxHash,
      amountXrp: fixedAmount,
      destinationAddress: d.destinationAddress
    });

      callTrackChainTx(d.destinationAddress);
  } catch (e) {
    console.error(`Failed to update records for errorLogId=${d._id}:`, e);
  }
}
// if (i === 10) break;

    rows.push({
      _id: String(d._id),
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
      userId: d.userId ? String(d.userId) : '',
      ledgerRowId: d.ledgerRowId ? String(d.ledgerRowId) : '',
      destination: d.destinationAddress || '',
      amountXRP: Number(amountXRP.toFixed(6)),
      feeXRP: Number(feeXRP.toFixed(6)),
      newtshash: xrpTxHash,
      engineResult: engine || '',
      txHash: hash || ''
    });
  }

  // Console table (show up to 50 rows for visibility)
  console.table(rows.slice(0, Math.min(rows.length, 50)));

  // Summary
  console.log(`\nSummary:
  Records:          ${rows.length}
  Total Attempted:  ${totalAttempted.toFixed(6)} XRP
  Total Fees Burnt: ${totalFees.toFixed(6)} XRP
`);

  // Write CSV + JSON
  const ts = Date.now();
  const csvHeaders = ['_id','createdAt','userId','ledgerRowId','destination','amountXRP','feeXRP','engineResult','txHash','newtshash'];
  const csv = [
    csvHeaders.join(','),
    ...rows.map(r => csvHeaders.map(h => csvEscape(r[h])).join(','))
  ].join('\n');

  const csvPath = path.resolve(process.cwd(), `unfunded_withdrawals_${ts}.csv`);
  const jsonPath = path.resolve(process.cwd(), `unfunded_withdrawals_${ts}.json`);
  fs.writeFileSync(csvPath, csv, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(docs, null, 2), 'utf8');

  

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  mongoose.disconnect().catch(()=>{});
  process.exit(1);
});
