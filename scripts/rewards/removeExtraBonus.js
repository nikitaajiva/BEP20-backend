/**
 * revertJuly5BoosterDoubleAdd.js
 *
 * Removes the July-5 Community-Booster rewards that were applied twice.
 *
 * --dryrun   : preview the changes without saving
 */

const mongoose = require('mongoose');
const Ledger = require('../../models/Ledger');        // <-- update path if necessary

/* ------------------------------------------------------------------ */
/* 1.  Hard-coded corrections                                         */
/* ------------------------------------------------------------------ */
const corrections = [
  { userId: '68416df15d8deee438fb7dd3', amount: 1.80588 },
  { userId: '68416df05d8deee438fafc0a', amount: 2.7894 },
  { userId: '68416df05d8deee438fae117', amount: 1.7639359428683998 },
  { userId: '68416df05d8deee438fae10d', amount: 3.3111863665767824 },
  { userId: '68416df05d8deee438fae250', amount: 2.2896053001648156 },
  { userId: '68416df05d8deee438fae281', amount: 1.221192 },
  { userId: '68416df05d8deee438fae110', amount: 3.354 },
  { userId: '68416df05d8deee438fae28a', amount: 2.68950871110048 },
  { userId: '68416df05d8deee438fae194', amount: 12.071058923353268 },
  { userId: '68416df05d8deee438fae113', amount: 1.9075915880999998 },
  { userId: '68416df05d8deee438fb2271', amount: 1.224 },
  { userId: '68416df05d8deee438fae2fb', amount: 11.2417799826974 },
  { userId: '68416df05d8deee438fae10a', amount: 27.585851857592683 },
  { userId: '68416df05d8deee438fae2d7', amount: 2.899071471543828 },
  { userId: '68416df05d8deee438fae290', amount: 3.5759999999999996 },
  { userId: '685f0a99133e29c2f1228735', amount: 3.6534858909408 },
  { userId: '68416df05d8deee438fae57e', amount: 1.737 },
  { userId: '68416df05d8deee438fae10b', amount: 12.019913527427313 },
  { userId: '68416df05d8deee438fb22a4', amount: 2.7894 },
  { userId: '68416df05d8deee438fae2ce', amount: 1.5 },
];

/* ------------------------------------------------------------------ */
/* 2.  Database helpers                                               */
/* ------------------------------------------------------------------ */
const DRY_RUN = process.argv.includes('--dryrun');

async function connectDB() {
  const uri =
    process.env.TEST_DB_URI ||
    process.env.MONGODB_URI ||
    'mongodb://localhost:27017/xrpmigrate';

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  
}

/* ------------------------------------------------------------------ */
/* 3.  Correction routine                                             */
/* ------------------------------------------------------------------ */
async function revertDoubleAdds() {
  await connectDB();

  console.log(
    `${DRY_RUN ? 'Previewing' : 'Applying'} subtraction for ${
      corrections.length
    } users …`
  );

  for (const { userId, amount } of corrections) {
    const ledger = await Ledger.findOne({ userId });

    if (!ledger) {
      console.warn(`No ledger for user ${userId}`);
      continue;
    }

    const usedNow = ledger?.limits?.fiveXLimit?.used
      ? parseFloat(ledger.limits.fiveXLimit.used.toString())
      : 0;

    const newUsed = usedNow - amount;

    if (DRY_RUN) {
      console.log(
        `  [dry] User ${userId} – current ${usedNow} ➜ new ${newUsed} (–= ${amount})`
      );
      continue;
    }

    ledger.limits           ||= {};
    ledger.limits.fiveXLimit ||= {};
    ledger.limits.fiveXLimit.used = mongoose.Types.Decimal128.fromString(
      newUsed.toFixed(8)
    );

    await ledger.save();
    
  }

  
  await mongoose.disconnect();
  
}

/* ------------------------------------------------------------------ */
/* 4.  CLI                                                            */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  revertDoubleAdds()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Correction failed:', err);
      process.exit(1);
    });
}

module.exports = { revertDoubleAdds };
