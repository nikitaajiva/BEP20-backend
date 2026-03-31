/**
 * Script: updateLpWithBackup.js
 * Usage:
 *   node scripts/admin/updateLpWithBackup.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const User = require("../../models/User");
const Ledger = require("../../models/Ledger");
const LedgerRow = require("../../models/LedgerRow");

const { Decimal128 } = mongoose.Types;


const LOG_DIR = path.join(__dirname, "../../logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const LOG_FILE = path.join(
  LOG_DIR,
  `lp-update-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
);

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  
};


/* ===============================
   USER → LP MAP
================================ */
const USERS = [
  { email: "xrptra.nsoceanrippleblockchain@gmail.com", lp: 10000 },
  { email: "xrp1234.56789ripple987654321@gmail.com", lp: 10000 },
  { email: "platform.founderclubleadersxman@gmail.com", lp: 10000 },
  { email: "rammohanm133@gmail.com", lp: 6000 },
  { email: "sunnyshukla9887@gmail.com", lp: 4200 },
  { email: "surajkhemux@gmail.com", lp: 4800 },
  { email: "johnsondavexx@gmail.com", lp: 5100 },
  { email: "subrat.x40@atomicmail.io", lp: 4000 },
  { email: "abhi.x041@atomicmail.io", lp: 6000 },
  { email: "jcmahadik@gmail.com", lp: 3000 },
  { email: "marketing.tss2010@gmail.com", lp: 3000 },
  { email: "operations.tss2010@gmail.com", lp: 3000 },
  { email: "tarunamu2@gmail.com", lp: 3000 },
  { email: "tss.hrandtaxmanagementservices@gmail.com", lp: 3000 },
  { email: "oughsecurity2010@gmail.com", lp: 3000 },
  { email: "shashikala.d015@atomicmail.io", lp: 4200 },
  { email: "gourang.d016@atomicmail.io", lp: 5800 },
  { email: "hritik.d022@atomicmail.io", lp: 4300 },
  { email: "harish.d023@atomicmail.io", lp: 5690 },
  { email: "rezwan.x029@atomicmail.io", lp: 4100 },
  { email: "malik.x030@atomicmail.io", lp: 5894 },
  { email: "ambikasharma19812025@gmail.com", lp: 4800 },
  { email: "seenasharmaxrp@yahoo.com", lp: 5100 },
  { email: "dineshsafir@gmail.com", lp: 4200 },
  { email: "nallinni425@gmail.com", lp: 5400 },
  { email: "ruchixrp@yahoo.com", lp: 4600 },
  { email: "nalini4581@gmail.com", lp: 5500 },
  { email: "globaltime86.0@gmail.com", lp: 4400 },
  { email: "globaltime8.60@gmail.com", lp: 5600 },
  { email: "oceanxrp33@gmail.com", lp: 4300 },
  { email: "teamdrok5@gmail.com", lp: 4500 },
  { email: "firstline1.03@gmail.com", lp: 4990 },
  { email: "firstline10.3@gmail.com", lp: 4995 },
  { email: "xrpxmen@hotmail.com", lp: 4000 },
  { email: "xrpx1@hotmail.com", lp: 5700 },
  { email: "tanjo1916@gmail.com", lp: 5700 },
  { email: "tanjo1917@gmail.com", lp: 4200 },
  { email: "oceanxrp99@gmail.com", lp: 4000 },
  { email: "ocean.xrp99@gmail.com", lp: 5500 },
  { email: "platform5425@gmail.com", lp: 5000 },
  { email: "platform54526@gmail.com", lp: 4900 },
  { email: "platform54527@gmail.com", lp: 4000 },
  { email: "platform54528@gmail.com", lp: 5500 },
  { email: "platform54524@gmail.com", lp: 4300 },
  { email: "platform54529@gmail.com", lp: 5700 },
  { email: "platform1212@gmail.com", lp: 5000 },
  { email: "Platform8@gmail.com", lp: 1000 },
  { email: "jaihobaba636@gmail.com", lp: 10000 },
  { email: "jaihomaa7@gmail.com", lp: 10000 },
  { email: "xrpggn0007@gmail.com", lp: 5700 },
  { email: "xrpggn006@gmail.com", lp: 4300 },
  { email: "xrpggn0008@gmail.com", lp: 4900 },
  { email: "xrpggn0009@gmail.com", lp: 5100 },
  { email: "iamrockstar501@gmail.com", lp: 10000 },
  { email: "platform570@gmail.com", lp: 3500 },
  { email: "platform810@gmail.com", lp: 6500 },
  { email: "platform425@gmail.com", lp: 3600 },
  { email: "platform50@gmail.com", lp: 6400 },
  { email: "xrp1674@gmail.com", lp: 3500 },
  { email: "xrp1676@gmail.com", lp: 6500 },
  { email: "d69386274@gmail.com", lp: 3500 },
  { email: "digitalx601@gmail.com", lp: 6500 },
  { email: "platform1111@gmail.com", lp: 2500 },
  { email: "platform011@gmail.com", lp: 5000 },
  { email: "markus123456789tt@gmail.com", lp: 2500 },
  { email: "jack123123ttt@gmail.com", lp: 5000 },
  { email: "panikax.65@atomicmail.io", lp: 4092 },
  { email: "sanzix.66@atomicmail.io", lp: 5892 },
  { email: "skyvasishtha@outlook.com", lp: 3700 },
  { email: "xrpxmen@outlook.com", lp: 6500 },
  { email: "crazytigerxrp@outlook.com", lp: 3400 },
  { email: "orangewatermelonxrp@outlook.com", lp: 6900 },
  { email: "chavansachin64@outlook.com", lp: 3500 },
  { email: "platform@outlook.com", lp: 6300 },
  { email: "indiatdm18@gmail.com", lp: 3300 },
  { email: "myindiatdm@gmail.com", lp: 6500 },
  { email: "w6451443@gmail.com", lp: 3030 },
  { email: "gmfottin@gmail.com", lp: 6060 },
];

/* ===============================
   RUN
================================ */
(async () => {
  try {
    await connectDB();
    log("✅ MongoDB connected");

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const u of USERS) {
      log(`--- Processing ${u.email} ---`);

      const user = await User.findOne({ email: u.email }, { _id: 1 }).lean();
      if (!user) {
        log(`⚠️ USER NOT FOUND`);
        skipped++;
        continue;
      }

      const ledger = await Ledger.findOne({ userId: user._id });
      if (!ledger) {
        log(`⚠️ LEDGER NOT FOUND`);
        skipped++;
        continue;
      }

      const oldLp = ledger.wallets?.lp
        ? ledger.wallets.lp.toString()
        : "0";

      log(`Old LP: ${oldLp}`);
      log(`Target LP: ${u.lp}`);

      try {
        /* ===============================
           BACKUP
        ================================ */
        ledger.lpBackup = ledger.wallets.lp;
        ledger.lpBackupAt = new Date();

        /* ===============================
           UPDATE LP
        ================================ */
        ledger.wallets.lp = Decimal128.fromString(String(u.lp));
        await ledger.save();

        /* ===============================
           VERIFY AFTER SAVE
        ================================ */
        const verify = await Ledger.findById(
          ledger._id,
          { "wallets.lp": 1, lpBackup: 1 }
        ).lean();

        const newLp = verify?.wallets?.lp?.toString() || "0";

        if (newLp === String(u.lp)) {
          log(`✅ UPDATED | LP ${oldLp} → ${newLp}`);
          updated++;
        } else {
          log(`❌ MISMATCH | Expected ${u.lp} but DB has ${newLp}`);
          failed++;
        }
      } catch (err) {
        log(`❌ ERROR: ${err.message}`);
        failed++;
      }
    }

    log("=================================");
    log(`✅ Updated : ${updated}`);
    log(`❌ Failed  : ${failed}`);
    log(`⚠️ Skipped : ${skipped}`);
    log("=================================");

    process.exit(0);
  } catch (err) {
    log(`🔥 FATAL ERROR: ${err.message}`);
    process.exit(1);
  }
})();
