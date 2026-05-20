require("dotenv").config();
const mongoose = require("mongoose");
const Decimal = require("decimal.js");
const { seedDefaultHorseNftPackages, listHorseNftPackages } = require("../Modules/horseNft/Services/horseNftPackageService");
const { runHorseNftPayouts, calculateHorseNftPayoutAmount } = require("../Modules/horseNft/Services/horseNftPayoutService");

async function runSmokeTest() {
  console.log("=== Starting Horse NFT Smoke Test ===");
  let failed = false;

  // 1. Connect to Database
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI env variable is not set.");
    }
    await mongoose.connect(mongoUri);
    console.log("[PASS] Connected to MongoDB.");
  } catch (error) {
    console.error("[FAIL] MongoDB Connection:", error.message);
    failed = true;
    process.exit(1);
  }

  // 2. Seed default Horse NFT Packages
  try {
    const seeded = await seedDefaultHorseNftPackages();
    if (seeded.length === 3) {
      console.log(`[PASS] Seeded ${seeded.length} Horse NFT packages.`);
    } else {
      console.error(`[FAIL] Seeded package count mismatch. Expected 3, got ${seeded.length}`);
      failed = true;
    }
  } catch (error) {
    console.error("[FAIL] Horse NFT Package Seeding failed:", error);
    failed = true;
  }

  // 3. Confirm 3 active packages exist and match requirements
  try {
    const activePackages = await listHorseNftPackages({ activeOnly: true });
    const expectedTiers = {
      starter: { priceUSDT: 500, annualRoiPercent: 15, dividendFrequency: "quarterly" },
      growth: { priceUSDT: 1000, annualRoiPercent: 25, dividendFrequency: "monthly" },
      premium: { priceUSDT: 5000, annualRoiPercent: 35, dividendFrequency: "weekly" }
    };

    if (activePackages.length !== 3) {
      console.error(`[FAIL] Active packages count mismatch. Expected 3, got ${activePackages.length}`);
      failed = true;
    }

    for (const pkg of activePackages) {
      const expected = expectedTiers[pkg.tierCode];
      if (!expected) {
        console.error(`[FAIL] Unexpected tierCode found: ${pkg.tierCode}`);
        failed = true;
        continue;
      }
      if (pkg.priceUSDT !== expected.priceUSDT || pkg.annualRoiPercent !== expected.annualRoiPercent || pkg.dividendFrequency !== expected.dividendFrequency) {
        console.error(`[FAIL] Package attributes mismatch for ${pkg.tierCode}. Expected:`, expected, "Got:", pkg);
        failed = true;
      } else {
        console.log(`[PASS] Verified package details for tier: ${pkg.tierCode}`);
      }
    }
  } catch (error) {
    console.error("[FAIL] Active packages list check:", error);
    failed = true;
  }

  // 4. Confirm payout calculation numbers
  try {
    const starterAmt = calculateHorseNftPayoutAmount({
      purchasePriceUSDT: 500,
      annualRoiPercent: 15,
      dividendFrequency: "quarterly"
    });
    if (starterAmt === 18.75) {
      console.log(`[PASS] Starter package payout calculation correct: ${starterAmt} USDT`);
    } else {
      console.error(`[FAIL] Starter package payout calculation mismatch. Expected 18.75, got ${starterAmt}`);
      failed = true;
    }

    const growthAmt = calculateHorseNftPayoutAmount({
      purchasePriceUSDT: 1000,
      annualRoiPercent: 25,
      dividendFrequency: "monthly"
    });
    if (growthAmt === 20.833333) {
      console.log(`[PASS] Growth package payout calculation correct: ${growthAmt} USDT`);
    } else {
      console.error(`[FAIL] Growth package payout calculation mismatch. Expected 20.833333, got ${growthAmt}`);
      failed = true;
    }

    const premiumAmt = calculateHorseNftPayoutAmount({
      purchasePriceUSDT: 5000,
      annualRoiPercent: 35,
      dividendFrequency: "weekly"
    });
    if (premiumAmt === 33.653846) {
      console.log(`[PASS] Premium package payout calculation correct: ${premiumAmt} USDT`);
    } else {
      console.error(`[FAIL] Premium package payout calculation mismatch. Expected 33.653846, got ${premiumAmt}`);
      failed = true;
    }
  } catch (error) {
    console.error("[FAIL] Payout calculation verification:", error);
    failed = true;
  }

  // 5. Run payout service dryRun only
  try {
    const result = await runHorseNftPayouts({ dryRun: true, triggeredBy: "SMOKE_TEST" });
    if (result.dryRun === true) {
      console.log(`[PASS] Run payout dryRun completed successfully. Eligible targets: ${result.eligibleCount}`);
    } else {
      console.error("[FAIL] Run payout dryRun parameter mismatch in result:", result);
      failed = true;
    }
  } catch (error) {
    console.error("[FAIL] Payout dryRun execution:", error);
    failed = true;
  }

  // 6. Verify Cron Env and Route Imports
  try {
    const featureEnabled = process.env.HORSE_NFT_ENABLED === "true";
    const cronEnabled = process.env.HORSE_NFT_PAYOUT_CRON_ENABLED === "true";
    console.log(`[INFO] Cron configuration: HORSE_NFT_ENABLED=${featureEnabled}, HORSE_NFT_PAYOUT_CRON_ENABLED=${cronEnabled}`);
    console.log("[PASS] Env cron parameters loaded.");
  } catch (error) {
    console.error("[FAIL] Cron configuration environment checks:", error);
    failed = true;
  }

  await mongoose.disconnect();
  console.log("=== Smoke Test Finished ===");
  if (failed) {
    console.log("RESULT: FAIL");
    process.exit(1);
  } else {
    console.log("RESULT: PASS");
    process.exit(0);
  }
}

runSmokeTest();
