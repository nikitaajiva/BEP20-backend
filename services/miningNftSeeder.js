const mongoose = require("mongoose");
const NftTier = require("../models/NftTier");

const toDecimal128 = (value) =>
  mongoose.Types.Decimal128.fromString(String(value || "0"));

const miningTiers = [
  {
    code: "N1",
    name: "Starter Miner",
    mintPriceU: toDecimal128(100),
    miningPower: toDecimal128(100),
    powerCoefficient: toDecimal128(0.7),
    poolMultiplierBeforeTsc: toDecimal128(2.0),
    poolMultiplierAfterTsc: toDecimal128(2.5),
    dailyYieldRatePercent: toDecimal128(0.5),
    sortOrder: 1,
  },
  {
    code: "N2",
    name: "Pro Miner",
    mintPriceU: toDecimal128(500),
    miningPower: toDecimal128(500),
    powerCoefficient: toDecimal128(0.8),
    poolMultiplierBeforeTsc: toDecimal128(2.0),
    poolMultiplierAfterTsc: toDecimal128(2.8),
    dailyYieldRatePercent: toDecimal128(0.5),
    sortOrder: 2,
  },
  {
    code: "N3",
    name: "Advanced Miner",
    mintPriceU: toDecimal128(1000),
    miningPower: toDecimal128(1000),
    powerCoefficient: toDecimal128(0.9),
    poolMultiplierBeforeTsc: toDecimal128(2.0),
    poolMultiplierAfterTsc: toDecimal128(3.0),
    dailyYieldRatePercent: toDecimal128(0.5),
    sortOrder: 3,
  },
  {
    code: "N4",
    name: "Elite Miner",
    mintPriceU: toDecimal128(3000),
    miningPower: toDecimal128(3000),
    powerCoefficient: toDecimal128(1.0),
    poolMultiplierBeforeTsc: toDecimal128(2.0),
    poolMultiplierAfterTsc: toDecimal128(3.5),
    dailyYieldRatePercent: toDecimal128(0.5),
    sortOrder: 4,
  },
  {
    code: "N5",
    name: "Master Miner",
    mintPriceU: toDecimal128(10000),
    miningPower: toDecimal128(10000),
    powerCoefficient: toDecimal128(1.1),
    poolMultiplierBeforeTsc: toDecimal128(2.0),
    poolMultiplierAfterTsc: toDecimal128(4.0),
    dailyYieldRatePercent: toDecimal128(0.5),
    sortOrder: 5,
  },
];

async function seedDefaultMiningNftTiers() {
  try {
    const count = await NftTier.countDocuments({});
    if (count > 0) {
      console.log(`[Seeder] NftTier collection has ${count} records. Skipping seed.`);
      return;
    }

    console.log("[Seeder] Seeding default Mining NFT Tiers (N1 to N5)...");
    await NftTier.insertMany(miningTiers);
    console.log("[Seeder] Seeded default Mining NFT Tiers successfully.");
  } catch (error) {
    console.error("[Seeder] Error seeding Mining NFT Tiers:", error);
  }
}

module.exports = {
  seedDefaultMiningNftTiers,
};
