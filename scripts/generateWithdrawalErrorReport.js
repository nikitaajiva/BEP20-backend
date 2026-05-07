/**
 * Script: generateWithdrawalErrorReport.js
 */


const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
// MODELS
const WithdrawalError = require("../models/WithdrawalErrorLog");
const User = require("../models/User");

// CLI Args Helper
const getArg = (flag) => {
  const arg = process.argv.find((x) => x.startsWith(flag));
  return arg ? arg.split("=")[1] : null;
};

const FROM = getArg("--from");
const TO = getArg("--to");

if (!FROM || !TO) {
  console.error("❌ Please provide --from=YYYY-MM-DD and --to=YYYY-MM-DD");
  process.exit(1);
}

const FROM_DATE = new Date(`${FROM}T00:00:00Z`);
const TO_DATE = new Date(`${TO}T23:59:59Z`);



async function generateReport() {
  try {
    // CONNECT MONGODB (WAIT FOR CONNECTION)
     await connectDB();
    

    // RUN AGGREGATION
    const records = await WithdrawalError.aggregate([
      {
        $match: {
          createdAt: { $gte: FROM_DATE, $lt: TO_DATE },
          errorCode: { $ne: "RESOLVED" }
        }
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },

      {
        $project: {
          _id: 0,
          username: "$user.username",
          uhid: "$user.uhid",
          walletFrom: 1,
          destinationAddress: 1,
          amount: 1,
          createdAt: {
            $dateToString: {
              format: "%Y-%m-%d %H:%M:%S",
              date: "$createdAt",
              timezone: "Asia/Kolkata"
            }
          }
        }
      },
      { $sort: { createdAt: 1 } }
    ]);

    

    // CREATE REPORT FOLDER IF MISSING
    const reportsDir = path.join(__dirname, "../reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    const filePath = path.join(
      reportsDir,
      `WithdrawalErrorReport_${Date.now()}.xlsx`
    );

    // CREATE EXCEL FILE
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Withdrawal Errors");

    sheet.addRow([
      "Username",
      "UHID",
      "Wallet From",
      "Destination Address",
      "Amount",
      "Created At"
    ]);

    sheet.getRow(1).font = { bold: true };

    records.forEach((r) => {
      sheet.addRow([
        r.username,
        r.uhid,
        r.walletFrom,
        r.destinationAddress,
        r.amount.toString(),
        r.createdAt
      ]);
    });

    sheet.columns.forEach((col) => {
      let maxLength = 15;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 10;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 5;
    });

    // SAVE FILE
    await workbook.xlsx.writeFile(filePath);

    
    

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error while generating report:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

generateReport();
