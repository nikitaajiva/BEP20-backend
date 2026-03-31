/**
 * dailyUserLpReport.js
 * -------------------------------------------------------
 * Generate Excel report for dailyuserlps collection
 * Filters records by a provided date (YYYY-MM-DD)
 * and exports columns: username, uhid, lp, date
 * -------------------------------------------------------
 * Usage:
 *   node scripts/dailyUserLpReport.js 2025-10-26
 * -------------------------------------------------------
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// 🟢 DB + Models
const connectDB = require("../config/db");
const DailyUserLp = require("../models/DailyUserLp");
const User = require("../models/User");

const ExcelJS = require("exceljs");

async function generateDailyUserLpReport(targetDateStr) {
  if (!targetDateStr) {
    console.error("❌ Please provide a date. Example: node dailyUserLpReport.js 2025-10-26");
    process.exit(1);
  }

  const targetDate = new Date(targetDateStr);
  const nextDate = new Date(targetDate);
  nextDate.setDate(nextDate.getDate() + 1);

  try {
    
    await connectDB();
    

    

    const records = await DailyUserLp.find({
      date: { $gte: targetDate, $lt: nextDate },
    }).lean();

    if (!records.length) {
      
      return;
    }

    

    // 🧾 Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Daily User LP");

    worksheet.columns = [
      { header: "Username", key: "username", width: 25 },
      { header: "UHID", key: "uhid", width: 20 },
      { header: "LP", key: "lp", width: 20 },
      { header: "Date", key: "date", width: 20 },
    ];

    // Add rows
    let totalLp = 0;
    for (const r of records) {
      const lp = Number(r.lp || 0);
      totalLp += lp;

      worksheet.addRow({
        username: r.username,
        uhid: r.uhid,
        lp: lp.toFixed(6),
        date: new Date(r.date).toISOString().split("T")[0],
      });
    }

    // Add total row
    const totalRow = worksheet.addRow({
      username: "TOTAL",
      uhid: "",
      lp: totalLp.toFixed(6),
      date: "",
    });
    totalRow.font = { bold: true };
    totalRow.alignment = { horizontal: "right" };

    // Style headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { horizontal: "center" };

    // Ensure /reports directory exists
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Save file in /reports directory
    const fileName = `DailyUserLpReport_${targetDateStr}.xlsx`;
    const outputPath = path.join(reportsDir, fileName);
    await workbook.xlsx.writeFile(outputPath);

    
  } catch (err) {
    console.error("❌ Error generating report:", err);
  } finally {
    const mongoose = require("mongoose");
    await mongoose.disconnect();
    
  }
}

// Run via CLI
const dateArg = process.argv[2];
generateDailyUserLpReport(dateArg);
