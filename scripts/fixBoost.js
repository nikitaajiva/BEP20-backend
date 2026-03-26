const mongoose = require('mongoose');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const { addDecimal128, multiplyDecimal128, ensureDecimal128, convertToFloat, subtractDecimal128 } = require('../utils/decimal128Utils');
require('dotenv').config({ path: '../.env' });


const connectDB = async () => {
    try {
        await mongoose.connect("mongodb://localhost:27017/xrpmigrate", {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB Connected...');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
};

const main = async () => {
    await connectDB();
    console.log('Processing boost credits...');

    const deposits = await LedgerRow.find({ eventType: 'LP_DEPOSIT_FROM_XAMAN' }).sort({ ts: 1 });
    console.log(`Found ${deposits.length} LP_DEPOSIT_FROM_XAMAN events to process.`);
    let creditCount = 0;
    let creditsTobeAdded = [];
    let creditsAlreadyAdded = [];

    let totalAmount = 0;
    let totalDeposits = 0;
    for (const deposit of deposits) {
        const depositor = await User.findById(deposit.userId);
        if (!depositor || !depositor.sponsorId) {
            continue;
        }

        const sponsorId = depositor.sponsorId;

        const sponsorFirstLp = await LedgerRow.findOne({ userId: sponsorId, eventType: 'LP_DEPOSIT_FROM_XAMAN' }).sort({ ts: 1 });
        if (!sponsorFirstLp) {
            continue;
        }

        const sponsorFirstLpTs = new Date(sponsorFirstLp.ts).getTime();
        const depositTs = new Date(deposit.ts).getTime();

        const hoursDiff = (depositTs - sponsorFirstLpTs) / (1000 * 60 * 60);

        let bonusPercentage;
        if (hoursDiff < 48) {
            bonusPercentage = 0.50;
        } else if (hoursDiff >= 48 && hoursDiff < 216) {
            bonusPercentage = 0.30;
        } else {
            bonusPercentage = 0.20;
        }

        const depositAmountD128 = ensureDecimal128(deposit.amount);
        const expectedBonusD128 = multiplyDecimal128(depositAmountD128, bonusPercentage.toString());

        // --------------------------------------------------------------------------
        // find out whether the sponsor was already paid for THIS deposit
        // --------------------------------------------------------------------------
        const TIME_WINDOW_MS = 20 * 1000; // ±1 min window
        const tolerance = ensureDecimal128('0.1'); // amount tolerance
        const expectedBonus = multiplyDecimal128(depositAmountD128, bonusPercentage.toString());
        const lower = subtractDecimal128(expectedBonus, tolerance);
        const upper = addDecimal128(expectedBonus, tolerance);

        // 1. Check for a bonus that is already correctly linked to this deposit.
        // 1️⃣  Already corrected?  (fast path – normal refId)
        let correctCredit = await LedgerRow.findOne(   {
                  eventType        : 'BOOST_BONUS',
                  refId            : depositor._id,          // ← bugged key
                  legacyRefIdFixed : false,
                   amount           : { $gte: lower, $lte: upper },
                })
        if (correctCredit) {
            creditsAlreadyAdded.push(correctCredit);
            continue;
        }
       
        // const legacy = await LedgerRow.findOne(
        //     {
        //       eventType        : 'BOOST_BONUS',
        //       refId            : depositor._id,          // ← bugged key
        //       legacyRefIdFixed : false,                  // still unused
        //       amount           : { $gte: lower, $lte: upper },
        //       ts               : {
        //         $gte: new Date(deposit.ts - TIME_WINDOW_MS),
        //         $lte: new Date(deposit.ts + TIME_WINDOW_MS)
        //       }
        //     }
        // ,
        //     {
        //       $set : {                                   // stamp it
        //         refId           : deposit._id,
        //         legacyRefIdFixed: true
        //       }
        //     },
        //     { new: false }                               // we don’t need the doc
        //   );
          
        //   if (legacy) continue;     

        // // 3. If no correct or legacy bonus was found, create a new one.
        // console.log(`Crediting sponsor ${sponsorId} for deposit ${deposit._id} from user ${deposit.userId}`);

        // const upsert = await LedgerRow.updateOne(
        //     { eventType: 'BOOST_BONUS', refId: deposit._id },   // unique filter
        //     {
        //       $setOnInsert: {
        //         userId   : sponsorId,
        //         amount   : expectedBonus,
        //         walletTo : 'boost',
        //         narrative: `Boost adjustment from ${depositor.username} for `
        //                  + `${depositAmountD128} LP deposit`,
        //         ts       : new Date(deposit.ts.getTime() + 1)
        //       }
        //     },
        //     { upsert: true }
        //   );
          
        //   // Only the first script run actually moves money
        //   if (upsert.upsertedId) {
        //     await Ledger.updateOne(
        //       { userId: sponsorId },
        //       { $inc: { 'wallets.boost': expectedBonus } }
        //     );
        //     console.log(`Credited ${expectedBonus} to sponsor ${sponsorId}`);
        //   }
        // find users.find({sponsorId: sponsorId})
        const sponsor = await User.findOne({_id: sponsorId});
          creditCount++;
          creditsTobeAdded.push({
            userId: sponsor.username,
            amount: expectedBonusD128,
            narrative: `Boost adjustment for deposit on ${deposit.ts} from ${depositor.username} for ${depositAmountD128} LP at rate of ${bonusPercentage.toString()}, sponsor firsttLPdate ${sponsorFirstLpTs}`,
            refId: deposit._id,
            ts: new Date(deposit.ts.getTime() + 1)
          });
          // add decimal128 to totalAmount
          totalAmount = addDecimal128(totalAmount, expectedBonusD128);
          totalDeposits = addDecimal128(totalDeposits, depositAmountD128);
       //   console.log(sponsor, sponsorId);

        //   console.log({
        //     userId: sponsor.username,
        //     amount: expectedBonusD128,
        //     narrative: `Boost adjustment for deposit on ${deposit.ts} from ${depositor.username} for ${depositAmountD128} LP at rate of ${bonusPercentage.toString()}, sponsor firsttLPdate ${sponsorFirstLpTs}`,
        //     refId: deposit._id,
        //     ts: new Date(deposit.ts.getTime() + 1)
        //   })
        
    }

    console.log('Finished processing boost credits.');
    console.log(`Total credits: ${creditCount}`);
    console.log(`Total deposits: ${deposits.length}`);
    console.log(`Credits to be added: ${creditsTobeAdded.length}`);
    console.log(`Total amount: ${totalAmount}`);
    console.log(`Total deposits: ${totalDeposits}`);
    console.log(`Credits already added: ${creditsAlreadyAdded.length}`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
}); 