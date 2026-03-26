/**
 * Exception Boost Report (Enhanced + Boost Rewards Yesterday)
 * ---------------------------------------------------------
 * Adds NEW COLUMN:
 *   - boostRewardYesterday: SUM of DAILY_REWARDS_BOOST ledger rows for yesterday
 *
 * Saves to /reports/ExceptionBoostReport_<timestamp>.xlsx
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// DB + Models
const connectDB = require("../config/db");
const Ledger = require("../models/Ledger");
const User = require("../models/User");
const ChainDeposit = require("../models/ChainDeposit");
const ChainWithdrawal = require("../models/ChainWithdrawal");
const LedgerRow = require("../models/LedgerRow");  // 🔥 Needed for Boost Reward

// 🔹 UHIDs to include
const EXCEPTION_UHIDS = [
  // (your list unchanged)
  "1754734201443","1762493388752","1757959930191","1758791903676","1758114607655",
  "1758114585037","17470523327625","17479224136444","17470555591784","17470585986771",
  "17470516223919","1750231172","1750241606","1763464994641","1760943805801",
  "1763651517501","17477217478685","17470520022595","17470511049371","1755236839951",
  "17470115393776","17470301828349","1754724291416","1753116411141","1754244558300",
  "1753179039893","1753172439695","1753196579739","1751039755","1754407144489",
  "1754838594235","1754583207094","1754668601750","17470321597976","17470328215855",
  "17470495204647","1749555592","1749555840","1751036651","1751132636","1752131403635",
  "1753972330223","1754823969799","1754824255985","1754845801859","1754846752754",
  "1754850621024","1754853326240","1756820266794","1758274250925","1759414465429",
  "1759495277557","1760092913539","1760541465586","1760767595069","1760625488279",
  "1757931096796","17471561217489","1760189709881","1760372733602","1760767595069",
  "1760693186803","1757269252798","1761491833495","1760628745253","1763622746467",
  "1755054140887","1763409728731","1761596415391"
];

async function generateBoostReport() {
  await connectDB();

  try {
    console.log("🔍 Fetching users matching provided UHIDs...");

    // Fetch users
    const users = await User.find(
      { uhid: { $in: EXCEPTION_UHIDS } },
      "username email uhid firstLpDepositTs"
    );

    if (!users.length) {
      console.log("⚠️ No users found matching UHIDs.");
      process.exit(0);
    }

    const userIds = users.map((u) => u._id);

    // Fetch ledgers
    const ledgers = await Ledger.find({ userId: { $in: userIds } });

    console.log(`✅ Found ${ledgers.length} ledger(s).`);

    // Compute yesterday UTC window
    const today = new Date();
    const utcYest = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - 1
    ));
    const startYest = new Date(utcYest.setHours(0,0,0,0));
    const endYest   = new Date(utcYest.setHours(23,59,59,999));

    // Prepare Excel workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Boost Report");

    sheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "Email", key: "email", width: 30 },
      { header: "Wallet Boost", key: "boost", width: 18 },
      { header: "Boost Limit Cap", key: "cap", width: 18 },
      { header: "Boost Limit Used", key: "used", width: 18 },
      { header: "Remaining (Cap - Used)", key: "remaining", width: 25 },
      { header: "Boost Reward Given", key: "boostYesterday", width: 22 },  // 🔥 NEW COLUMN
      { header: "First LP Deposit Ts", key: "firstLpDepositTs", width: 30 },
      { header: "Onchain Deposits (XRP)", key: "onchainDeposits", width: 22 },
      { header: "Onchain Withdrawals (XRP)", key: "onchainWithdrawals", width: 24 },
    ];

    ["D", "E", "F", "G", "H", "J", "K"].forEach((col) => {
      try { sheet.getColumn(col).numFmt = "0.000000"; } catch {}
    });

    // Loop users
    for (const user of users) {
      const ledger = ledgers.find(
        (l) => l.userId.toString() === user._id.toString()
      );
      if (!ledger) continue;

      const boost = parseFloat(ledger.wallets?.boost?.toString() || 0);
      const cap = parseFloat(ledger.limits?.boostLimit?.cap?.toString() || 0);
      const used = parseFloat(ledger.limits?.boostLimit?.used?.toString() || 0);
      const remaining = parseFloat((cap - used).toFixed(6));

      // 🟩 NEW: Fetch BOOST rewards given yesterday
      const boostRows = await LedgerRow.aggregate([
        {
          $match: {
            userId: ledger.userId,
            eventType: "DAILY_REWARDS_BOOST",
            ts: { $gte: startYest, $lte: endYest }
          }
        },
        {
          $group: { _id: null, total: { $sum: "$amount" } }
        }
      ]);

      const boostYesterday = boostRows.length
        ? parseFloat(boostRows[0].total.toString())
        : 0;

      // Onchain totals
      const [deposits, withdrawals] = await Promise.all([
        ChainDeposit.aggregate([
          { $match: { userId: ledger.userId } },
          { $group: { _id: null, total: { $sum: "$amountXRP" } } },
        ]),
        ChainWithdrawal.aggregate([
          { $match: { userId: ledger.userId } },
          { $group: { _id: null, total: { $sum: "$amountXRP" } } },
        ]),
      ]);

      const onchainDeposits = deposits.length
        ? parseFloat(deposits[0].total.toString())
        : 0;
      const onchainWithdrawals = withdrawals.length
        ? parseFloat(withdrawals[0].total.toString())
        : 0;

      sheet.addRow({
        username: user.username || "",
        uhid: user.uhid || "",
        email: user.email || "",
        boost,
        cap,
        used,
        remaining,
        boostYesterday, // 🔥 NEW VALUE ADDED
        firstLpDepositTs: user.firstLpDepositTs
          ? new Date(user.firstLpDepositTs).toISOString()
          : "",
        onchainDeposits,
        onchainWithdrawals,
      });
    }

    // Save file
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const dateStr = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const filePath = path.join(
      reportsDir,
      `ExceptionBoostReport_${dateStr}.xlsx`
    );

    await workbook.xlsx.writeFile(filePath);

    console.log(`📊 Exception Boost Report generated successfully: ${filePath}`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Error generating Exception Boost Report:", err);
    process.exit(1);
  }
}


generateBoostReport();
