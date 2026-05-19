require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const ProtocolConfig = require('../models/ProtocolConfig');
const NftTier = require('../models/NftTier');
const NodeLevelConfig = require('../models/NodeLevelConfig');

const dec = (val) => mongoose.Types.Decimal128.fromString(String(val));

const defaultProtocolConfig = {
  key: "default",
  tscInitialPriceUSDT: dec(1),
  tscDailyIncreasePercent: dec(0.2),
  tscDailyIncreaseMinPercent: dec(0.2),
  tscDailyIncreaseMaxPercent: dec(0.5),
  tscReleaseMonths: 25,
  monthlyEmissionPercent: dec(4),
  tscWithdrawalFeePercent: dec(3),
  tscWithdrawalInstantPercent: dec(80),
  tscWithdrawalVestingPercent: dec(20),
  tscVestingDays: 90,
  tscToTkcSwapFeePercent: dec(3),
  referralLevel1Percent: dec(10),
  referralLevel2Percent: dec(5),
  assistanceRewardPercent: dec(10),
  isTscLaunched: false
};

const defaultNftTiers = [
  {
    code: 'N1',
    name: 'N1 Tier',
    mintPriceU: dec(100),
    miningPower: dec(100),
    powerCoefficient: dec(0.7),
    poolMultiplierBeforeTsc: dec(2.0),
    poolMultiplierAfterTsc: dec(2.5),
    dailyYieldRatePercent: dec(0.5),
    tscAllocationMode: 'EQUIVALENT',
    isActive: true,
    sortOrder: 1
  },
  {
    code: 'N2',
    name: 'N2 Tier',
    mintPriceU: dec(500),
    miningPower: dec(500),
    powerCoefficient: dec(0.8),
    poolMultiplierBeforeTsc: dec(2.0),
    poolMultiplierAfterTsc: dec(2.8),
    dailyYieldRatePercent: dec(0.75),
    tscAllocationMode: 'EQUIVALENT',
    isActive: true,
    sortOrder: 2
  },
  {
    code: 'N3',
    name: 'N3 Tier',
    mintPriceU: dec(1000),
    miningPower: dec(1000),
    powerCoefficient: dec(0.9),
    poolMultiplierBeforeTsc: dec(2.0),
    poolMultiplierAfterTsc: dec(3.0),
    dailyYieldRatePercent: dec(1.0),
    tscAllocationMode: 'EQUIVALENT',
    isActive: true,
    sortOrder: 3
  },
  {
    code: 'N4',
    name: 'N4 Tier',
    mintPriceU: dec(3000),
    miningPower: dec(3000),
    powerCoefficient: dec(1.0),
    poolMultiplierBeforeTsc: dec(2.0),
    poolMultiplierAfterTsc: dec(3.5),
    dailyYieldRatePercent: dec(1.25),
    tscAllocationMode: 'EQUIVALENT',
    isActive: true,
    sortOrder: 4
  },
  {
    code: 'N5',
    name: 'N5 Tier',
    mintPriceU: dec(10000),
    miningPower: dec(10000),
    powerCoefficient: dec(1.1),
    poolMultiplierBeforeTsc: dec(2.0),
    poolMultiplierAfterTsc: dec(4.0),
    dailyYieldRatePercent: dec(1.5),
    tscAllocationMode: 'EQUIVALENT',
    isActive: true,
    sortOrder: 5
  }
];

const defaultNodeLevels = [
  {
    code: 'P1',
    upgradeMiningPower: dec(10000),
    totalMiningPower: dec(30000),
    miningOutputPercent: dec(10),
    airdropAllocationPercent: dec(20),
    isActive: true,
    sortOrder: 1
  },
  {
    code: 'P2',
    upgradeMiningPower: dec(50000),
    totalMiningPower: dec(100000),
    miningOutputPercent: dec(20),
    airdropAllocationPercent: dec(15),
    isActive: true,
    sortOrder: 2
  },
  {
    code: 'P3',
    upgradeMiningPower: dec(150000),
    totalMiningPower: dec(300000),
    miningOutputPercent: dec(30),
    airdropAllocationPercent: dec(12.5),
    isActive: true,
    sortOrder: 3
  },
  {
    code: 'P4',
    upgradeMiningPower: dec(500000),
    totalMiningPower: dec(1000000),
    miningOutputPercent: dec(40),
    airdropAllocationPercent: dec(11.5),
    isActive: true,
    sortOrder: 4
  },
  {
    code: 'P5',
    upgradeMiningPower: dec(1500000),
    totalMiningPower: dec(3000000),
    miningOutputPercent: dec(50),
    airdropAllocationPercent: dec(10.5),
    isActive: true,
    sortOrder: 5
  },
  {
    code: 'P6',
    upgradeMiningPower: dec(3500000),
    totalMiningPower: dec(7000000),
    miningOutputPercent: dec(60),
    airdropAllocationPercent: dec(9.5),
    isActive: true,
    sortOrder: 6
  },
  {
    code: 'P7',
    upgradeMiningPower: dec(8000000),
    totalMiningPower: dec(16000000),
    miningOutputPercent: dec(70),
    airdropAllocationPercent: dec(8.5),
    isActive: true,
    sortOrder: 7
  },
  {
    code: 'P8',
    upgradeMiningPower: dec(16000000),
    totalMiningPower: dec(32000000),
    miningOutputPercent: dec(80),
    airdropAllocationPercent: dec(7.5),
    isActive: true,
    sortOrder: 8
  },
  {
    code: 'P9',
    upgradeMiningPower: dec(30000000),
    totalMiningPower: dec(64000000),
    miningOutputPercent: dec(90),
    airdropAllocationPercent: dec(5),
    isActive: true,
    sortOrder: 9
  }
];

async function seed() {
  console.log('Connecting to database...');
  await connectDB();

  // 1. Seed ProtocolConfig
  console.log('Seeding ProtocolConfig...');
  const protocolConfigResult = await ProtocolConfig.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: defaultProtocolConfig },
    { upsert: true, new: true }
  );
  console.log(`ProtocolConfig seeded successfully. Key: ${protocolConfigResult.key}`);

  // 2. Seed NFT Tiers
  console.log('Seeding NFT Tiers...');
  for (const tier of defaultNftTiers) {
    const res = await NftTier.findOneAndUpdate(
      { code: tier.code },
      { $setOnInsert: tier },
      { upsert: true, new: true }
    );
    console.log(`NFT Tier ${res.code} processed.`);
  }

  // 3. Seed Node Level Configs
  console.log('Seeding Node Level Configs...');
  for (const nodeLevel of defaultNodeLevels) {
    const res = await NodeLevelConfig.findOneAndUpdate(
      { code: nodeLevel.code },
      { $setOnInsert: nodeLevel },
      { upsert: true, new: true }
    );
    console.log(`Node Level ${res.code} processed.`);
  }

  console.log('Seeding complete!');
  await mongoose.disconnect();
  console.log('Disconnected from database.');
}

seed().catch((err) => {
  console.error('Seed script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
