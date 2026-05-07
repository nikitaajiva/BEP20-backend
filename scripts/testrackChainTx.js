/*
  Track Chain Transactions Script
  --------------------------------
  • Fetch all Users with xrpAddress + Ledger (LP > 0)
  • Query XRPL for each XRP address and classify transactions
  • Store results into cDeposits, cWithdrawals

  Run with:  node backend/scripts/trackChainTx.js [UHID|XRP address]
*/

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const OUR_DEPOSIT_DESTS = [
  "rpm1UCxixbtDsergFWNDA2pdhz4R1ooVNQ",
  "r3JaSKsYhXNmFYDhpJzetsSjDjJMAEAsMm",
  "rE6o6cmu39zfrYp47vp1MuTBWwvGU7mXe9",
  "r47ADkBED6LT9UQypUBBn4kxeVHq5PyXkX",
  "rBJkbrYpUB9vhn5UhzaEFmcNwX8ho2nwi8",
  "rMabpPf24wmJNNfCiVNLLkxKRraoaKD6oS",
];
const OUR_WITHDRAWAL_SOURCES = [
  "rfi4T2eHcjH4tTkJZ7izMu3TQFbckqY84M",
  "raEjhzmvKmmRpPxTxKPrVte66PAF7WVLt6",
  "rE6o6cmu39zfrYp47vp1MuTBWwvGU7mXe9",
  "rBJkbrYpUB9vhn5UhzaEFmcNwX8ho2nwi8",
  "rJhNaxHJyvSnzMoR5dY9iDmfAFJ8MgHoAR",
];

// Models
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const EcosystemFee = require("../models/EcosystemFee");
const LedgerRow = require("../models/LedgerRow");

const { Schema } = mongoose;

const txFields = {
  txHash: { type: String, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  uhid: String,
  amountXRP: Number,
  source: String,
  destination: String,
  ledgerIndex: Number,
  txDate: Date,
  raw: Schema.Types.Mixed,
};

const Deposit = mongoose.model("ChainDeposit", new Schema(txFields), "cDeposits");
const Withdrawal = mongoose.model("ChainWithdrawal", new Schema(txFields), "cWithdrawals");

// Totals map
const userTotals = new Map();
const ecoPosTotals = new Map();
const ecoRedeemedTotals = new Map();
const systemClaimed = new Map();

/* ---------------- PROCESS SINGLE USER ---------------- */
async function processUser(user) {
  try {
    

    // --- Fetch DB verified totals ---
    const onchainDepositAgg = await Deposit.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(user.userId) } },
      { $group: { _id: null, total: { $sum: "$amountXRP" } } },
    ]);
    const onchainWithdrawalAgg = await Withdrawal.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(user.userId) } },
      { $group: { _id: null, total: { $sum: "$amountXRP" } } },
    ]);

    const onchainDeposits = onchainDepositAgg[0]?.total || 0;
    const onchainWithdrawals = onchainWithdrawalAgg[0]?.total || 0;

    // Track in userTotals map
    const key = String(user.userId);
    userTotals.set(key, {
      deposit: Number(onchainDeposits),
      withdrawal: Number(onchainWithdrawals),
    });

    console.log(
      `📊 User ${user.uhid} (${user.xrpAddress}) | Onchain Deposits: ${onchainDeposits} | Withdrawals: ${onchainWithdrawals}`
    );

    // ---------------- System Claimed -----------------

    try {
      const sysClaimAgg = await LedgerRow.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(user.userId),
            walletFrom: "ZERO_RISK",
            walletTo: "EXTERNAL",
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
          },
        },
      ]);

         sysClaimValue = sysClaimAgg[0]?.total || 0;

      // Save into systemClaimed map
      systemClaimed.set(key, Number(sysClaimValue));
   if (sysClaimValue > 0) {
        console.log(
          `💸 System Claimed (ZERO_RISK → EXTERNAL): ${sysClaimValue} XRP for ${user.uhid}`
        );
      }
    } catch (sysErr) {
      console.error(`⚠️  SystemClaimed aggregation failed for ${user.uhid}:`, sysErr.message);
    }

    // ---------------- EcosystemFee Adjustments -----------------
    let totalredeemedEcofee;

    try {
      const redeemed = await EcosystemFee.aggregate([
        { $match: { narrative: /Rewards Redeem/i, userId: user.userId } },
        { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
      ]);

      if (redeemed.length && redeemed[0].totalAmount) {
        totalredeemedEcofee = Number(redeemed[0].totalAmount);
        ecoRedeemedTotals.set(String(user.userId), totalredeemedEcofee);
        console.log(
          `➖ Added Rewards Redeemed: ${redeemed[0].totalAmount} XRP (to withdrawal) for ${user.uhid}`
        );
      }

      const autoPos = await EcosystemFee.aggregate([
        { $match: { userId: user.userId } },
        {
          $project: {
            ledgerRefId: { $toObjectId: "$ledgerRefId" },
            amount: 1,
          },
        },
        {
          $lookup: {
            from: "ledgerrows",
            let: { ledgerId: "$ledgerRefId" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$ledgerId"] },
                  eventType: "AUTOPOSITIONING",
                },
              },
            ],
            as: "ledgerDoc",
          },
        },
        { $unwind: "$ledgerDoc" },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$ledgerDoc.amount" },
            totalEcosystemFee: { $sum: "$amount" },
          },
        },
      ]);

      if (autoPos.length && autoPos[0].totalAmount) {
        ecoPosTotals.set(String(user.userId), {
          ecoFee: Number(autoPos[0].totalEcosystemFee),
          withoutEco: Number(autoPos[0].totalAmount),
        });
        console.log(
          `➕ Added AutoPositioning: ${autoPos[0].totalAmount} XRP (to deposit) for ${user.uhid}`
        );
        console.log(
          `➕ AutoPositioning Ecofee: ${autoPos[0].totalEcosystemFee} XRP for ${user.uhid}`
        );
      }
    } catch (aggErr) {
      console.error(
        `⚠️  EcosystemFee aggregation failed for ${user.uhid}:`,
        aggErr.message
      );
    }
  } catch (err) {
    console.error("⚠️   Error processing address", user.xrpAddress, err.message);
  }
}

/* ---------------- MAIN ---------------- */
(async function main() {
  try {
    await connectDB();

    await Promise.all([
      Deposit.collection.createIndex({ txHash: 1 }, { unique: true }),
      Withdrawal.collection.createIndex({ txHash: 1 }, { unique: true }),
    ]);

    
    const target = process.argv[2];
    let userMatch = { xrpAddress: { $exists: true, $ne: "" } };

    if (target) {
      if (/^r[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(target)) {
        userMatch.xrpAddress = target;
        
      } else {
        userMatch.uhid = target;
        
      }
    }

  const pipeline = [
  { $match: userMatch },
  {
    $lookup: {
      from: "ledgers",
      localField: "uhid",
      foreignField: "uhid",
      as: "ledger",
    },
  },
  { $unwind: "$ledger" },
];

// Only enforce LP > 0 if not in single-user mode
if (!target) {
  pipeline.push({
    $match: {
      "ledger.wallets.lp": { $gt: mongoose.Types.Decimal128.fromString("0") },
    },
  });
}

pipeline.push(
  { $sort: { "ledger.wallets.lp": -1 } },
  {
    $project: {
      userId: "$_id",
      uhid: 1,
      xrpAddress: 1,
      lp: "$ledger.wallets.lp",
    },
  }
);

const users = await User.aggregate(pipeline).allowDiskUse(true);

    if (!users.length) {
      
      await mongoose.disconnect();
      process.exit(0);
    }

    

    if (target) {
      await processUser(users[0]);
    } else {
      let processed = 0;
      for (const user of users) {
        processed++;
        
        await processUser(user);
      }
    }

    

    /* ---------------- Scenario Calculation Section ---------------- */
    
    

    let userc = 1;
    for await (const [userId, tot] of userTotals.entries()) {
      const ledger = await Ledger.findById(userId).lean();
      if (!ledger) continue;

      const eco = ecoPosTotals.get(userId) || { ecoFee: 0, withoutEco: 0 };
      const totalredeemedEcofee = ecoRedeemedTotals.get(userId) || 0;
      const autoPosEcosystemFee = eco.ecoFee;
      const autoPositioningWithoutECO = eco.withoutEco;

      const available = parseFloat(ledger.wallets?.xaman?.toString() || "0");
      const redeemed = parseFloat(ledger.totalRewardsWithdrawal?.toString() || "0");
      const rewardsUsed = parseFloat(ledger.limits?.fiveXLimit?.used?.toString() || "0");
      const communityRewardsBalance = parseFloat(
        ledger.wallets?.communityRewards?.toString() || "0"
      );

      const cal_autopositioning = rewardsUsed - redeemed - communityRewardsBalance;
      const autopositioningWithoutFee =
        cal_autopositioning - (autoPosEcosystemFee + autoPositioningWithoutECO);
      const autopositioningToAddOnLP = cal_autopositioning - autoPosEcosystemFee;
      const addAutoPositioningZeroRisk = autoPositioningWithoutECO;
      const autopositioningForLP = autopositioningToAddOnLP - autoPositioningWithoutECO;

      
      
    const claimedvalue = systemClaimed.get(userId);
     // 884
      const totalDeposits = tot.deposit + addAutoPositioningZeroRisk;
      const totalWithdrawals = tot.withdrawal + totalredeemedEcofee;
      const claim = (totalWithdrawals - redeemed)-totalredeemedEcofee;

      let zeroRisk = totalDeposits - totalWithdrawals;
      zeroRisk += addAutoPositioningZeroRisk;

      let zeroRiskNegativeBalance = 0;
      if (zeroRisk < 0) {
        zeroRiskNegativeBalance = Math.abs(zeroRisk);
        zeroRisk = 0;
      }

      const lp = totalDeposits + autopositioningForLP - Math.max(0, claimedvalue);

     // if (tot.deposit < tot.withdrawal) {
        // await Ledger.updateOne(
        //   { _id: userId },
        //   {
        //     $set: {
        //       "wallets.lp": mongoose.Types.Decimal128.fromString(lp.toString()),
        //       "limits.boostLimit.cap": mongoose.Types.Decimal128.fromString(lp.toString()),
        //       "wallets.zeroRisk": mongoose.Types.Decimal128.fromString(zeroRisk.toString()),
        //       "wallets.zeroRiskNegativeBalance": mongoose.Types.Decimal128.fromString(
        //         zeroRiskNegativeBalance.toString()
        //       ),
        //       lastUpdatedAt: new Date(),
        //     },
        //   }
        // );
        
  //    } else {
      //   
      // }

      
      

      console.log(
        `User: ${ledger.uhid} | Deposits: ${totalDeposits.toFixed(
          6
        )} XRP | Withdrawals: ${totalWithdrawals.toFixed(6)} XRP`
      );
      
      
      
      
      
      console.log(
        `  Autopositioning Without applied Fee: ${autopositioningWithoutFee.toFixed(6)}`
      );
      console.log(
        `  Autopositioning Fee applied on: ${autoPositioningWithoutECO.toFixed(6)}`
      );
      
      console.log(
        `  Autopositioning to be add on LP: ${autopositioningToAddOnLP.toFixed(6)}`
      );
      console.log(
        `  Autopositioning to be add on Zerorisk: ${addAutoPositioningZeroRisk.toFixed(6)}`
      );
      
      
      
      
      
      

      userc++;
    }
  } catch (err) {
    console.error("Fatal error:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
