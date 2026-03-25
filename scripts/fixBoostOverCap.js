// scripts/fixBoostOverCap.js
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");

const EXCEPTION_UHIDS = [
  "1754734201443", 
  "1762493388752",
  "1757959930191",
  "1758791903676",
  "1758114607655",
  "1758114585037",
  "17470523327625",
  "17479224136444",
  "17470555591784",
  "17470585986771",
  "17470516223919",
  "1750231172",
  "1750241606",
  "1763464994641",
  "1760943805801",
  "1763651517501",
  "17477217478685",
  "17470520022595",
  "17470511049371",
  "1755236839951",
  "17470115393776",
  "17470301828349",
  "1754724291416",
  "1753116411141",
  "1754244558300",
  "1753179039893",
  "1753172439695",
  "1753196579739",
  "1751039755",
  "1754407144489",
  "1754838594235",
  "1754583207094",
  "1754668601750",
  "17470321597976",
  "17470328215855",
  "17470495204647",
  "1749555592",
  "1749555840",
  "1751036651",
  "1751132636",
  "1752131403635",
  "1753972330223",
  "1754823969799",
  "1754824255985",
  "1754845801859",
  "1754846752754",
  "1754850621024",
  "1754853326240",
  "1756820266794",
  "1758274250925",
  "1759414465429",
  "1759495277557",
  "1760092913539",
  "1760541465586",
  "1760767595069",
  "1760625488279",
  "1757931096796",
  "17471561217489",
  "1760189709881",
  "1760372733602",
  "1760767595069",
  "1760693186803",
  "1757269252798",
  "1761491833495",
  "1760628745253",
  "1763622746467",
  "1755054140887",
  "1763409728731",
  "1761596415391"
];


const run = async () => {
  try {
    await connectDB();

    console.log("🚀 Checking ledgers where wallets.boost > limits.boostLimit.cap ...");

    // Count before update (excluding exceptions)
    const beforeCount = await Ledger.countDocuments({
      $expr: { $gt: ["$wallets.boost", "$limits.boostLimit.cap"] },
      uhid: { $nin: EXCEPTION_UHIDS },
    });

    console.log(`⚠️ Found ${beforeCount} ledgers exceeding boost cap (excluding exceptions).`);

    if (beforeCount === 0) {
      console.log("✅ No fixes needed.");
      process.exit(0);
    }

    // Perform update using aggregation pipeline (excluding exceptions)
    const result = await Ledger.updateMany(
      {
        $expr: { $gt: ["$wallets.boost", "$limits.boostLimit.cap"] },
        uhid: { $nin: EXCEPTION_UHIDS },
      },
      [
        {
          $set: {
            "wallets.boost": "$limits.boostLimit.cap",
          },
        },
      ]
    );

    console.log(`✅ Updated ${result.modifiedCount} ledgers.`);

    // Double check after update
    const afterCount = await Ledger.countDocuments({
      $expr: { $gt: ["$wallets.boost", "$limits.boostLimit.cap"] },
      uhid: { $nin: EXCEPTION_UHIDS },
    });

    console.log(`📊 Remaining records exceeding cap (excluding exceptions): ${afterCount}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error fixing boost over cap:", err);
    process.exit(1);
  }
};

run();
