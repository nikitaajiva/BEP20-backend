/**
 * List unfunded/failed withdrawal errors and auto-fix missing amount
 *
 * Behavior:
 * - DRY RUN BY DEFAULT (no writes/sends). Pass --apply to execute.
 * - DEFAULT TIME WINDOW = TODAY (UTC 00:00 → 24:00), unless --days/--since/--until/--all provided.
 * - If error log amount <= 0 (or null/NaN), try to recover amount from LedgerRow:
 *     1) d.uniqueTransactionId -> LedgerRow.uniqueTransactionId
 *     2) Else d.ledgerRowId -> LedgerRow._id
 *   When found and positive:
 *     - DRY: log what would be updated
 *     - APPLY: update withdrawalerrorlogs.amount (Decimal128) and proceed
 * - Skip if destination missing or LedgerRow already has a refId (already broadcasted).
 * - Writes an APPEND-ONLY log to /root/b/logs/processed_failed_transaction.log (no CSV/JSON).
 *
 * Usage:
 *   node scripts/listUnfundedWithdrawal.js                # DRY-RUN (today only)
 *   node scripts/listUnfundedWithdrawal.js --apply        # APPLY (today only)
 *   node scripts/listUnfundedWithdrawalErrors.js --limit=200
 *   node scripts/listUnfundedWithdrawalErrors.js --days=3
 *   node scripts/listUnfundedWithdrawalErrors.js --since=2025-08-13T00:00:00Z --until=2025-08-15T00:00:00Z
 *   node scripts/listUnfundedWithdrawalErrors.js --user=6896358a81f21435e1c888be
 *   node scripts/listUnfundedWithdrawalErrors.js --codes=temBAD_AMOUNT,tefPAST_SEQ
 *   node scripts/listUnfundedWithdrawalErrors.js --regex="temBAD_AMOUNT|tefPAST_SEQ"
 *   node scripts/listUnfundedWithdrawalErrors.js --all
 *   node scripts/listUnfundedWithdrawalErrors.js --id=68bfc19521e4609158f4eeed
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const LedgerRow = require('../models/LedgerRow');
const xrpTransactions = require("../utils/xrpTransactions");
// --- 🔄 Track Chain TX Integration ---
const { spawn } = require('child_process');
const trackChainScript = path.join(__dirname, 'trackChainTx.js');

function callTrackChainTx(xrpAddress) {
  try {
    if (!xrpAddress) {
      console.log(`⚠️ No XRP address provided for trackChainTx`);
      return;
    }

    const child = spawn('node', [trackChainScript, xrpAddress], {
      stdio: 'ignore',
      detached: true,
    });

    // Event handlers
    child.on('error', (error) => {
      console.log(`⚠️ trackChainTx spawn error for ${xrpAddress}:`, error.message);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ trackChainTx completed successfully for ${xrpAddress}`);
      } else {
        console.log(`⚠️ trackChainTx exited with code ${code} for ${xrpAddress}`);
      }
    });

    console.log(`🔄 trackChainTx started for user: ${xrpAddress}`);
    return child;
  } catch (error) {
    console.log(`❌ trackChainTx function error for ${xrpAddress}:`, error.message);
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

// ⚙️ DRY-RUN is default. Use --apply to actually perform writes/sends.
const APPLY = has('apply') && !has('dry');
const DRY = !APPLY;

let LIMIT = Number(flag('limit', '100')) || 100;
if (APPLY) LIMIT = 15;
const DAYS  = Number(flag('days', '0')) || 0;     // default 0 => TODAY WINDOW
const SINCE = flag('since', null);
const UNTIL = flag('until', null);
const ALL   = has('all');
const USER  = flag('user', null); // userId string
const CODES = flag('codes', null); // e.g. --codes=temBAD_AMOUNT,tefPAST_SEQ
const REGEX = CODES
  ? CODES.split(',').map(s => s.trim()).filter(Boolean).join('|')
  : flag('regex', 'TimeoutError|NotConnectedError'); // default to both
const RECORD_ID = flag('id', null);

// ---- Logging setup (append-only) ----
const LOG_DIR = '/root/b/logs';
const LOG_PATH = path.join(LOG_DIR, 'processed_failed_transaction.log');
function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}
function writeLog(line = '') {
  ensureLogDir();
  fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
}
function nowIso() { return new Date().toISOString(); }

// Loose model to read raw fields
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
  // DEFAULT: TODAY (if no other flag provided)
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
  // No flags? → today window
  return utcTodayWindow();
}

const csvEscape = (v) => { // kept for clean string logging
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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

/** Prefer log.amount; fallback to xrpResponse tx_json amounts; returns Number XRP */
function deriveAmountXrpFromLog(doc) {
  const top = toNum(doc.amount);
  if (top > 0) return top;
  const amtDropsStr = pick(doc, 'xrpResponse.data.tx_json.Amount', null)
                   ?? pick(doc, 'xrpResponse.data.tx_json.DeliverMax', null);
  const drops = amtDropsStr ? Number(amtDropsStr) : 0;
  return drops / 1_000_000;
}

/** Fee in XRP (Number) if present in xrpResponse */
function deriveFeeXrp(doc) {
  const feeDropsStr = pick(doc, 'xrpResponse.data.tx_json.Fee', '0');
  const drops = Number(feeDropsStr || 0);
  return drops / 1_000_000;
}

/** Try to repair amount if <= 0 by reading LedgerRow via uniqueTransactionId or ledgerRowId */
async function repairMissingAmountIfAny(d) {
  let current = deriveAmountXrpFromLog(d);
  if (current > 0) return { amountXrp: current, repaired: false, wouldWrite: false };

  const logUTID = d.uniqueTransactionId || d.uniqueTxnId || d.uniqueTxn || null;
  let lr = null;
  if (logUTID) {
    lr = await LedgerRow.findOne({ uniqueTransactionId: logUTID }, { amount: 1, _id: 1 }).lean();
  }
  if (!lr && d.ledgerRowId && mongoose.isValidObjectId(d.ledgerRowId)) {
    lr = await LedgerRow.findById(d.ledgerRowId, { amount: 1, _id: 1 }).lean();
  }

  const amountFromLR = lr ? toNum(lr.amount) : 0;
  if (amountFromLR > 0) {
    if (DRY) {
      const msg = `DRY: would set withdrawalerrorlogs.amount for _id=${d._id} ⇒ ${amountFromLR.toFixed(6)} XRP`;
      console.log(`🧪 ${msg}`);
      writeLog(`[${nowIso()}] ${msg}`);
      return { amountXrp: amountFromLR, repaired: true, wouldWrite: true };
    }
    await WithdrawalErrorLog.updateOne(
      { _id: d._id },
      { $set: { amount: mongoose.Types.Decimal128.fromString(amountFromLR.toFixed(6)) } }
    );
    const msg = `APPLY: set withdrawalerrorlogs.amount for _id=${d._id} ⇒ ${amountFromLR.toFixed(6)} XRP`;
    console.log(`🩹 ${msg}`);
    writeLog(`[${nowIso()}] ${msg}`);
    return { amountXrp: amountFromLR, repaired: true, wouldWrite: false };
  }

  return { amountXrp: current, repaired: false, wouldWrite: false };
}

/** Set error resolved + refId + narrative */
async function updateWithNewTxHash({ errorLogId, ledgerRowId, newHash, destinationAddress }) {
  const dest = destinationAddress || '';
  const baseNarrative = dest ? `Withdrawal initiated to ${dest}` : 'Withdrawal initiated to';

  if (DRY) {
    const msg = `DRY: would mark errorLog ${errorLogId} RESOLVED with hash ${newHash}` +
                (ledgerRowId ? `; set LedgerRow(${ledgerRowId}).refId + narrative` : '');
    console.log(`🧪 ${msg}`);
    writeLog(`[${nowIso()}] ${msg}`);
    return;
  }

  const ops = [];
  ops.push(
    WithdrawalErrorLog.updateOne(
      { _id: errorLogId },
      {
        $set: {
          errorCode: 'RESOLVED',
          errorMessage: `Retried: broadcasted new tx hash ${newHash}`,
          xrpResponse: `${newHash}`,
          stackTrace: `Retried: broadcasted new tx hash ${newHash}`,
          updatedAt: new Date()
        },
      }
    )
  );

  if (ledgerRowId && mongoose.isValidObjectId(ledgerRowId)) {
    ops.push(
      LedgerRow.updateOne(
        { _id: new mongoose.Types.ObjectId(ledgerRowId) },
        {
          $set: {
            refId: newHash,
            narrative: baseNarrative,
            updatedAt: new Date(),
          },
        }
      )
    );
  }

  await Promise.all(ops);
  writeLog(`[${nowIso()}] APPLY: marked errorLog ${errorLogId} resolved; set refId & narrative on LedgerRow ${ledgerRowId || '-'} (${baseNarrative})`);
}

(async () => {
  await connectDB();

  const { start, end } = getWindow();
  const errorRegex = new RegExp(REGEX, 'i');

  const match = {};
  if (RECORD_ID) {
    match._id = new mongoose.Types.ObjectId(RECORD_ID);
  } else {
    match.createdAt = { $gte: start, $lt: end };
    // ✅ Skip very recent entries (less than 5 minutes old) when APPLY
  if (APPLY) {
    const fiveMinAgo = new Date(Date.now() - 35 * 60 * 1000);
    match.createdAt.$lt = new Date(Math.min(match.createdAt.$lt.getTime(), fiveMinAgo.getTime()));
  }
    match.$or = [
      { errorMessage: errorRegex },
      { 'xrpResponse.name': errorRegex },
      { stackTrace: errorRegex },
      { 'xrpResponse.data.meta.TransactionResult': errorRegex },
      { 'xrpResponse.data.outcome.result': errorRegex },
    ];
    if (USER) match.userId = new mongoose.Types.ObjectId(USER);
  }

  const header = `=== ${DRY ? 'DRY-RUN' : 'APPLY'} @ ${nowIso()} ===
Window: ${start.toISOString()} → ${end.toISOString()}
Filter: /${REGEX}/  |  Limit: ${LIMIT}${USER ? `  |  userId=${USER}` : ''}${RECORD_ID ? `  |  id=${RECORD_ID}` : ''}`;
  console.log(header);
  writeLog(header);

  const cursor = WithdrawalErrorLog.find(match, {}).sort({ createdAt: -1, _id: -1 }).limit(LIMIT);
  const docs = await cursor.lean();

  console.log(`Found: ${docs.length} record(s)\n`);
  writeLog(`Found: ${docs.length} record(s)`);

  const rows = [];
  let totalAttempted = 0;
  let totalFees = 0;

  for (const d of docs) {
    const dest = d.destinationAddress || '';
    const ledgerRowId =
      d.ledgerRowId && mongoose.isValidObjectId(d.ledgerRowId)
        ? new mongoose.Types.ObjectId(d.ledgerRowId)
        : null;
    
  // ✅ Extra safety: skip recent entries in APPLY mode
  const createdAt = d.createdAt ? new Date(d.createdAt) : null;
  if (APPLY && createdAt && (Date.now() - createdAt.getTime()) < 5 * 60 * 1000) {
    const msg = `SKIP _id=${d._id}: entry too recent (${createdAt.toISOString()})`;
    console.warn(`⏭️  ${msg}`);
    writeLog(`[${nowIso()}] ${msg}`);
    continue;
  }    

    const { amountXrp, repaired } = await repairMissingAmountIfAny(d);
    if (repaired) {
      // already logged inside helper
    }

    const feeXRP = deriveFeeXrp(d);

    if (!dest) {
      const msg = `SKIP _id=${d._id}: missing destinationAddress`;
      console.warn(`⏭️  ${msg}`);
      writeLog(`[${nowIso()}] ${msg}`);
      continue;
    }
    if (!(amountXrp > 0)) {
      const msg = `SKIP _id=${d._id}: amount still invalid (${amountXrp})`;
      console.warn(`⏭️  ${msg}`);
      writeLog(`[${nowIso()}] ${msg}`);
      continue;
    }

  if (ledgerRowId) {
    const lr = await LedgerRow.findById(ledgerRowId, { refId: 1 }).lean();
    if (lr?.refId) {
      const msg = `SKIP _id=${d._id}: LedgerRow already has refId=${lr.refId} (payment likely done)`;
      console.warn(`⏭️  ${msg}`);
      writeLog(`[${nowIso()}] ${msg}`);

      await WithdrawalErrorLog.updateOne(
        { _id: d._id },
        {
          $set: {
            errorCode: "RESOLVED",
            errorMessage: `Already has refId ${lr.refId} (payment likely done)`,
            xrpResponse: `${lr.refId}`,
            stackTrace: `LedgerRow already updated`,
            updatedAt: new Date()
          }
        }
      );

      writeLog(
        `[${nowIso()}] ${DRY ? "DRY+UPDATE" : "APPLY"}: marked withdrawalerrorlogs ${d._id} resolved because LedgerRow already had refId=${lr.refId}`
      );

      continue; // no broadcast needed
    }
  }


    const fixedAmount = Number(parseFloat(amountXrp).toFixed(6));
    totalAttempted += fixedAmount;
    totalFees += feeXRP;

    // 5) Broadcast payment
    let xrpTxHash = '';
    if (DRY) {
      const msg = `DRY: would send ${fixedAmount} XRP to ${dest}${ledgerRowId ? ` (ledgerRowId=${ledgerRowId})` : ''}`;
      console.log(`🧪 ${msg}`);
      writeLog(`[${nowIso()}] ${msg}`);
    } else {
      try {
        const txResult = await xrpTransactions.sendXRP(dest, fixedAmount, d.ledgerRowId);
        xrpTxHash = txResult?.hash || '';
        const msg = `SENT ${fixedAmount} XRP to ${dest}  |  hash=${xrpTxHash || 'n/a'}`;
        
        console.log(`✅ ${msg}`);
        writeLog(`[${nowIso()}] ${msg}`);
        callTrackChainTx(dest);
      } catch (err) {
        const msg = `sendXRP failed for errorLogId=${d._id}: ${err?.message || err}`;
        console.error(`❌ ${msg}`);
        writeLog(`[${nowIso()}] ${msg}`);
      }
    }

    // 6) Update records if we have a new hash (only in APPLY mode)
    if (!DRY && xrpTxHash) {
      try {
        await updateWithNewTxHash({
          errorLogId: d._id,
          ledgerRowId: d.ledgerRowId,
          newHash: xrpTxHash,
          destinationAddress: dest
        });
      } catch (e) {
        const msg = `Failed to update records for errorLogId=${d._id}: ${e?.message || e}`;
        console.error(msg);
        writeLog(`[${nowIso()}] ${msg}`);
      }
    } else if (DRY) {
      writeLog(`[${nowIso()}] DRY: would mark error as resolved and set LedgerRow.refId if hash returned`);
    }

    const engine = pick(d, 'xrpResponse.data.meta.TransactionResult', pick(d, 'xrpResponse.data.outcome.result', ''));
    const hash   = pick(d, 'xrpResponse.data.hash', pick(d, 'xrpResponse.data.tx_json.hash', ''));

    rows.push({
      _id: String(d._id),
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : '',
      userId: d.userId ? String(d.userId) : '',
      ledgerRowId: d.ledgerRowId ? String(d.ledgerRowId) : '',
      destination: dest,
      amountXRP: Number(fixedAmount.toFixed(6)),
      feeXRP: Number(feeXRP.toFixed(6)),
      engineResult: engine || '',
      txHash: hash || '',
      newtshash: xrpTxHash || ''
    });

    // Per-row concise log line
    writeLog(`[${nowIso()}] ROW _id=${String(d._id)} dest=${dest} amt=${fixedAmount.toFixed(6)} fee=${feeXRP.toFixed(6)} engine=${engine || ''} oldHash=${hash || ''} newHash=${xrpTxHash || ''}`);
  }

  // Console table (top 50 rows for quick view)
  console.table(rows.slice(0, Math.min(rows.length, 50)));

  // Summary (console + log)
  const summary = `Summary (${DRY ? 'DRY-RUN' : 'APPLY'}):
  Records processed: ${rows.length}
  Total Attempted:   ${totalAttempted.toFixed(6)} XRP
  Total Fees (from logs): ${totalFees.toFixed(6)} XRP
  Log file: ${LOG_PATH}
`;
  console.log('\n' + summary);
  writeLog(summary);

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  writeLog(`[${nowIso()}] FATAL: ${err?.stack || err}`);
  mongoose.disconnect().catch(()=>{});
  process.exit(1);
});
