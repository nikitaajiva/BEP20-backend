/**
 * ============================================================
 * TOKINGGOLD — TSC NFT ECOSYSTEM
 * Cron Jobs: Jobs #1 through #11
 * ============================================================
 *
 * DEPENDENCIES (npm install):
 *   node-cron       — cron scheduling
 *   decimal.js      — precision arithmetic for token math
 *
 * HOW TO PLUG IN:
 *   Replace every call marked //[DB] with your ORM/DB query.
 *   Replace every call marked //[BLOCKCHAIN] with your Web3/contract call.
 *   Replace every call marked //[NOTIFY] with your notification service.
 *   All constants at the top can be moved to a .env or config file.
 * ============================================================
 */

const cron = require("node-cron");
const Decimal = require("decimal.js");

const logger = {
  info: (...args) => console.log("ℹ️", ...args),
  warn: (...args) => console.warn("⚠️", ...args),
  error: (...args) => console.error("❌", ...args),
};

// ─────────────────────────────────────────────
// CONSTANTS  (move to config / .env as needed)
// ─────────────────────────────────────────────
const CONFIG = {
  // Mining output range (percentage of equivalent TSC value per day)
  MINING_OUTPUT_MIN_PCT: new Decimal("0.005"), // 0.5%
  MINING_OUTPUT_MAX_PCT: new Decimal("0.015"), // 1.5%

  // TSC daily price increase band
  TSC_PRICE_INCREASE_MIN_PCT: new Decimal("0.002"), // 0.2%
  TSC_PRICE_INCREASE_MAX_PCT: new Decimal("0.005"), // 0.5%

  // Referral reward percentages
  REFERRAL_L1_PCT: new Decimal("0.10"), // 10%
  REFERRAL_L2_PCT: new Decimal("0.05"), //  5%

  // Assistance reward
  ASSISTANCE_REWARD_PCT: new Decimal("0.10"), // 10%

  // Withdrawal mechanics
  WITHDRAWAL_INSTANT_PCT: new Decimal("0.80"),   // 80% instant
  WITHDRAWAL_VESTING_PCT: new Decimal("0.20"),   // 20% over 90 days
  WITHDRAWAL_FEE_PCT: new Decimal("0.02"),        //  2% fee → airdrop pool
  WITHDRAWAL_VESTING_DAYS: 90,

  // TSC→TKC swap fee
  TSC_TO_TKC_SWAP_FEE_PCT: new Decimal("0.03"),  //  3%

  // Monthly emission
  MONTHLY_EMISSION_PCT: new Decimal("0.04"),      //  4% of total supply
  TOTAL_EMISSION_MONTHS: 25,

  // NFT tiers: [level]: { mintPrice, miningPower, powerCoefficient, poolMultiplier, poolMultiplierAfterTSC }
  NFT_TIERS: {
    N1: { mintPrice: 100,   miningPower: 100,   powerCoefficient: new Decimal("0.7"), poolMultiplier: new Decimal("2.0"), poolMultiplierAfterTSC: new Decimal("2.5") },
    N2: { mintPrice: 500,   miningPower: 500,   powerCoefficient: new Decimal("0.8"), poolMultiplier: new Decimal("2.0"), poolMultiplierAfterTSC: new Decimal("2.8") },
    N3: { mintPrice: 1000,  miningPower: 1000,  powerCoefficient: new Decimal("0.9"), poolMultiplier: new Decimal("2.0"), poolMultiplierAfterTSC: new Decimal("3.0") },
    N4: { mintPrice: 3000,  miningPower: 3000,  powerCoefficient: new Decimal("1.0"), poolMultiplier: new Decimal("2.0"), poolMultiplierAfterTSC: new Decimal("3.5") },
    N5: { mintPrice: 10000, miningPower: 10000, powerCoefficient: new Decimal("1.1"), poolMultiplier: new Decimal("2.0"), poolMultiplierAfterTSC: new Decimal("4.0") },
  },

  // Node tiers P1–P9
  // upgradeMiningPower and totalMiningPower are in units of ×10K U
  NODE_TIERS: {
    P1: { upgradeMiningPower: 1,    totalMiningPower: 3,    miningOutputPct: new Decimal("0.10"), airdropPct: new Decimal("0.20") },
    P2: { upgradeMiningPower: 5,    totalMiningPower: 10,   miningOutputPct: new Decimal("0.20"), airdropPct: new Decimal("0.15") },
    P3: { upgradeMiningPower: 15,   totalMiningPower: 30,   miningOutputPct: new Decimal("0.30"), airdropPct: new Decimal("0.125") },
    P4: { upgradeMiningPower: 50,   totalMiningPower: 100,  miningOutputPct: new Decimal("0.40"), airdropPct: new Decimal("0.115") },
    P5: { upgradeMiningPower: 150,  totalMiningPower: 300,  miningOutputPct: new Decimal("0.50"), airdropPct: new Decimal("0.105") },
    P6: { upgradeMiningPower: 350,  totalMiningPower: 700,  miningOutputPct: new Decimal("0.60"), airdropPct: new Decimal("0.095") },
    P7: { upgradeMiningPower: 800,  totalMiningPower: 1600, miningOutputPct: new Decimal("0.70"), airdropPct: new Decimal("0.085") },
    P8: { upgradeMiningPower: 1600, totalMiningPower: 3200, miningOutputPct: new Decimal("0.80"), airdropPct: new Decimal("0.075") },
    P9: { upgradeMiningPower: 3000, totalMiningPower: 6400, miningOutputPct: new Decimal("0.90"), airdropPct: new Decimal("0.05") },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: compute daily mining output for a single NFT
// Formula: miningPower × powerCoefficient × poolMultiplier × dailyRatePct
// The dailyRatePct is clamped between 0.5% and 1.5% based on tier strength.
// Higher coefficient + higher multiplier → closer to 1.5%.
// ─────────────────────────────────────────────────────────────────────────────
function computeDailyMiningOutput(nft, tscPriceUSD, tscLaunched) {
  const tier = CONFIG.NFT_TIERS[nft.level];
  if (!tier) throw new Error(`Unknown NFT level: ${nft.level}`);

  const poolMultiplier = tscLaunched
    ? tier.poolMultiplierAfterTSC
    : tier.poolMultiplier;

  // Normalise coefficient to a 0–1 scale relative to max coefficient (1.1)
  // to interpolate between min and max daily output pct
  const coeffNorm = tier.powerCoefficient.div(new Decimal("1.1")); // 0 → 1
  const dailyRatePct = CONFIG.MINING_OUTPUT_MIN_PCT.plus(
    CONFIG.MINING_OUTPUT_MAX_PCT.minus(CONFIG.MINING_OUTPUT_MIN_PCT).times(coeffNorm)
  );

  // TSC value equivalent = miningPower × tscPrice
  const tscEquivalentValue = new Decimal(tier.miningPower).times(tscPriceUSD);

  // Daily output in TSC = tscEquivalentValue × dailyRatePct × poolMultiplier
  const dailyTSC = tscEquivalentValue
    .times(dailyRatePct)
    .times(poolMultiplier);

  return dailyTSC;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB #1 — Daily NFT Mining Output Distribution
// Schedule: every day at 00:01 UTC
// Logic: For every staked NFT, compute daily TSC output and credit to holder.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("1 0 * * *", async () => {
  logger.info("[JOB#1] Starting: Daily NFT Mining Output Distribution");
  try {
    const tscPriceUSD = await getCurrentTSCPrice(); //[DB] fetch current TSC price
    const tscLaunched = await isTSCLaunched();       //[DB] boolean flag

    const stakedNFTs = await getAllStakedNFTs();     //[DB] returns array of { nftId, userId, level }

    let totalNetworkOutput = new Decimal(0);
    const miningResults = [];

    for (const nft of stakedNFTs) {
      const dailyTSC = computeDailyMiningOutput(nft, tscPriceUSD, tscLaunched);
      totalNetworkOutput = totalNetworkOutput.plus(dailyTSC);
      miningResults.push({ nftId: nft.nftId, userId: nft.userId, dailyTSC });

      await creditTSCToUser(nft.userId, dailyTSC, "NFT_MINING"); //[DB]
      await logMiningEvent(nft.nftId, dailyTSC, new Date());     //[DB]
    }

    // Store total network output so Jobs #3, #4, #5 can reference it
    await setDailyNetworkMiningTotal(totalNetworkOutput); //[DB] store as a daily snapshot

    logger.info(`[JOB#1] Done. NFTs processed: ${stakedNFTs.length}, Total network output: ${totalNetworkOutput.toFixed(6)} TSC`);
  } catch (err) {
    logger.error("[JOB#1] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #2 — Daily TSC Price Appreciation Update
// Schedule: every day at 00:05 UTC (before reward jobs that need price)
// Logic: increase TSC price by a rate within 0.2%–0.5% band.
//        Rate can be fixed or randomised within band — configurable.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("5 0 * * *", async () => {
  logger.info("[JOB#2] Starting: TSC Daily Price Appreciation");
  try {
    const currentPrice = await getCurrentTSCPrice(); //[DB]

    // Choose daily rate — use midpoint or pull from governance/config
    const dailyRate = CONFIG.TSC_PRICE_INCREASE_MIN_PCT.plus(
      CONFIG.TSC_PRICE_INCREASE_MAX_PCT.minus(CONFIG.TSC_PRICE_INCREASE_MIN_PCT).div(2)
    ); // defaults to 0.35% (midpoint); override with your governance value

    const newPrice = new Decimal(currentPrice).times(new Decimal(1).plus(dailyRate));

    await updateTSCPrice(newPrice);              //[DB] / [BLOCKCHAIN]
    await logPriceHistory(currentPrice, newPrice, dailyRate, new Date()); //[DB]

    logger.info(`[JOB#2] TSC price updated: ${currentPrice} → ${newPrice.toFixed(6)} USDT (+${dailyRate.times(100).toFixed(2)}%)`);
  } catch (err) {
    logger.error("[JOB#2] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #3 — Referral Reward Distribution
// Schedule: every day at 00:15 UTC (after Job #1 finishes)
// Logic:
//   Level 1 referrer → 10% of direct referral's daily mining output
//   Level 2 referrer → 5%  of L1 referral's referrer's mining output
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("15 0 * * *", async () => {
  logger.info("[JOB#3] Starting: Referral Reward Distribution");
  try {
    // Each record: { userId, dailyTSCEarned, referredByUserId }
    const minerOutputsToday = await getTodayMinerOutputs(); //[DB]

    for (const miner of minerOutputsToday) {
      const l1Referrer = await getReferrer(miner.userId);  //[DB] direct referrer
      if (!l1Referrer) continue;

      const l1Reward = new Decimal(miner.dailyTSCEarned).times(CONFIG.REFERRAL_L1_PCT);
      await creditTSCToUser(l1Referrer.userId, l1Reward, "REFERRAL_L1"); //[DB]

      const l2Referrer = await getReferrer(l1Referrer.userId); //[DB] referrer's referrer
      if (!l2Referrer) continue;

      const l2Reward = new Decimal(miner.dailyTSCEarned).times(CONFIG.REFERRAL_L2_PCT);
      await creditTSCToUser(l2Referrer.userId, l2Reward, "REFERRAL_L2"); //[DB]
    }

    logger.info(`[JOB#3] Done. Referral rewards distributed for ${minerOutputsToday.length} miners.`);
  } catch (err) {
    logger.error("[JOB#3] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #4 — Node Reward Distribution (P1–P9)
// Schedule: every day at 00:20 UTC (after Job #1)
// Logic:
//   1. Get today's total network mining output.
//   2. For each active node operator, find their tier.
//   3. Credit them their tier's % of total output.
//   Nodes must meet BOTH upgradeMiningPower AND totalMiningPower thresholds.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("20 0 * * *", async () => {
  logger.info("[JOB#4] Starting: Node Reward Distribution P1–P9");
  try {
    const totalNetworkOutput = await getDailyNetworkMiningTotal(); //[DB] set by Job #1

    // Each record: { userId, nodeLevel, upgradeMiningPower, totalMiningPower }
    const activeNodes = await getActiveNodeOperators(); //[DB]

    for (const node of activeNodes) {
      const tier = CONFIG.NODE_TIERS[node.nodeLevel];
      if (!tier) {
        logger.warn(`[JOB#4] Unknown node level for user ${node.userId}: ${node.nodeLevel}`);
        continue;
      }

      // Validate thresholds (×10K U)
      const meetsUpgrade = node.upgradeMiningPower >= tier.upgradeMiningPower * 10000;
      const meetsTotal   = node.totalMiningPower   >= tier.totalMiningPower   * 10000;

      if (!meetsUpgrade || !meetsTotal) {
        logger.warn(`[JOB#4] Node ${node.userId} (${node.nodeLevel}) does not meet thresholds — skipping.`);
        await flagNodeThresholdBreach(node.userId, node.nodeLevel); //[DB] optional alert
        continue;
      }

      const nodeReward = new Decimal(totalNetworkOutput).times(tier.miningOutputPct);
      await creditTSCToUser(node.userId, nodeReward, `NODE_REWARD_${node.nodeLevel}`); //[DB]
    }

    logger.info(`[JOB#4] Done. Node rewards distributed. Network output was: ${totalNetworkOutput} TSC`);
  } catch (err) {
    logger.error("[JOB#4] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #5 — Assistance Reward Distribution
// Schedule: every day at 00:25 UTC (after Job #1)
// Logic:
//   For each active assistance relationship, credit the assistant with
//   10% of the assisted miner's daily output.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("25 0 * * *", async () => {
  logger.info("[JOB#5] Starting: Assistance Reward Distribution");
  try {
    // Each record: { assistantUserId, assistedUserId }
    const assistanceLinks = await getActiveAssistanceRelationships(); //[DB]
    const minerOutputsToday = await getTodayMinerOutputsMap();        //[DB] Map<userId, dailyTSC>

    for (const link of assistanceLinks) {
      const assistedOutput = minerOutputsToday.get(link.assistedUserId);
      if (!assistedOutput) continue;

      const assistanceReward = new Decimal(assistedOutput).times(CONFIG.ASSISTANCE_REWARD_PCT);
      await creditTSCToUser(link.assistantUserId, assistanceReward, "ASSISTANCE_REWARD"); //[DB]
    }

    logger.info(`[JOB#5] Done. Assistance rewards for ${assistanceLinks.length} relationships.`);
  } catch (err) {
    logger.error("[JOB#5] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #6 — Airdrop Pool Weighted Distribution
// Schedule: every day at 01:00 UTC
// Logic:
//   Pool = accumulated 2% withdrawal fees (collected in real-time on withdrawals).
//   Distribution weight = (user's mining power) × (staking duration in days).
//   Each node level gets its airdrop % of the pool per the P1–P9 table.
//   Remaining pool after node distributions → weighted to all eligible miners.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 1 * * *", async () => {
  logger.info("[JOB#6] Starting: Airdrop Pool Weighted Distribution");
  try {
    const airdropPool = await getAirdropPoolBalance(); //[DB] accumulated 2% fees
    if (new Decimal(airdropPool).lte(0)) {
      logger.info("[JOB#6] Airdrop pool is empty — skipping.");
      return;
    }

    // ── Node-level airdrop slice ──────────────────────────────────────────
    const activeNodes = await getActiveNodeOperators(); //[DB]
    let totalDistributed = new Decimal(0);

    for (const node of activeNodes) {
      const tier = CONFIG.NODE_TIERS[node.nodeLevel];
      if (!tier) continue;

      const nodeAirdropShare = new Decimal(airdropPool).times(tier.airdropPct);
      await creditTSCToUser(node.userId, nodeAirdropShare, `AIRDROP_NODE_${node.nodeLevel}`); //[DB]
      totalDistributed = totalDistributed.plus(nodeAirdropShare);
    }

    // ── Remaining pool → weighted to all eligible miners ─────────────────
    const remainingPool = new Decimal(airdropPool).minus(totalDistributed);
    if (remainingPool.gt(0)) {
      // Each record: { userId, miningPower, stakingDurationDays }
      const eligibleMiners = await getAllEligibleMiners(); //[DB]

      // Compute total weight
      let totalWeight = new Decimal(0);
      const weights = eligibleMiners.map((m) => {
        const w = new Decimal(m.miningPower).times(m.stakingDurationDays);
        totalWeight = totalWeight.plus(w);
        return { ...m, weight: w };
      });

      for (const miner of weights) {
        if (totalWeight.eq(0)) break;
        const share = remainingPool.times(miner.weight.div(totalWeight));
        await creditTSCToUser(miner.userId, share, "AIRDROP_WEIGHTED"); //[DB]
      }
    }

    await resetAirdropPool(); //[DB] zero out the pool after distribution
    logger.info(`[JOB#6] Done. Airdrop pool of ${airdropPool} TSC distributed.`);
  } catch (err) {
    logger.error("[JOB#6] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #7 — TSC Re-staking Compounding
// Schedule: every day at 00:30 UTC
// Logic:
//   Users who stake their earned TSC back into the protocol earn
//   additional TSC on their staked TSC balance (true compounding loop).
//   Rate mirrors NFT mining output rates (0.5%–1.5%) scaled by stake size.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("30 0 * * *", async () => {
  logger.info("[JOB#7] Starting: TSC Re-staking Compounding Rewards");
  try {
    const tscPriceUSD = await getCurrentTSCPrice(); //[DB]

    // Each record: { userId, stakedTSCAmount, stakedSinceDays }
    const tscStakers = await getAllTSCStakers(); //[DB]

    for (const staker of tscStakers) {
      // Scale rate: larger + longer stakes trend toward 1.5%
      const stakeSizeFactor = Math.min(new Decimal(staker.stakedTSCAmount).div(10000).toNumber(), 1);
      const durationFactor  = Math.min(staker.stakedSinceDays / 365, 1);
      const blendedFactor   = new Decimal((stakeSizeFactor + durationFactor) / 2);

      const dailyRate = CONFIG.MINING_OUTPUT_MIN_PCT.plus(
        CONFIG.MINING_OUTPUT_MAX_PCT.minus(CONFIG.MINING_OUTPUT_MIN_PCT).times(blendedFactor)
      );

      const reward = new Decimal(staker.stakedTSCAmount).times(dailyRate);
      await creditTSCToUser(staker.userId, reward, "TSC_RESTAKE_COMPOUND"); //[DB]
    }

    logger.info(`[JOB#7] Done. Compounding rewards for ${tscStakers.length} TSC stakers.`);
  } catch (err) {
    logger.error("[JOB#7] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #8 — TKC Staking → TSC Reward Distribution
// Schedule: every day at 00:35 UTC
// Logic:
//   TKC holders (without NFTs) stake TKC → earn TSC.
//   Reward is proportional to their share of total TKC staked in the pool.
//   Total TSC reward pool for TKC stakers is set by protocol governance.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("35 0 * * *", async () => {
  logger.info("[JOB#8] Starting: TKC Staking → TSC Reward Distribution");
  try {
    const tkcStakers       = await getAllTKCStakers();           //[DB] { userId, stakedTKCAmount }
    const totalTKCStaked   = await getTotalTKCStaked();          //[DB] sum of all staked TKC
    const dailyTSCPoolForTKC = await getDailyTSCPoolForTKCStakers(); //[DB] daily budget

    if (new Decimal(totalTKCStaked).eq(0)) {
      logger.info("[JOB#8] No TKC staked — skipping.");
      return;
    }

    for (const staker of tkcStakers) {
      const share = new Decimal(staker.stakedTKCAmount).div(totalTKCStaked);
      const reward = new Decimal(dailyTSCPoolForTKC).times(share);
      await creditTSCToUser(staker.userId, reward, "TKC_STAKE_REWARD"); //[DB]
    }

    logger.info(`[JOB#8] Done. TKC staking TSC rewards distributed to ${tkcStakers.length} stakers.`);
  } catch (err) {
    logger.error("[JOB#8] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #9 — Monthly TSC Emission Release
// Schedule: 1st of every month at 02:00 UTC
// Logic:
//   Release exactly 4% of TOTAL TSC supply each month.
//   Runs for exactly 25 months then stops automatically.
//   Mints/unlocks tokens into the circulating emission pool.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 2 1 * *", async () => {
  logger.info("[JOB#9] Starting: Monthly TSC Emission Release");
  try {
    const emissionRecord = await getEmissionRecord(); //[DB] { monthsReleased, totalSupply }

    if (emissionRecord.monthsReleased >= CONFIG.TOTAL_EMISSION_MONTHS) {
      logger.info("[JOB#9] All 25 emission months complete. Job is now a no-op.");
      return;
    }

    const monthlyRelease = new Decimal(emissionRecord.totalSupply).times(CONFIG.MONTHLY_EMISSION_PCT);

    await releaseTokensToCirculation(monthlyRelease);                   //[DB] / [BLOCKCHAIN]
    await incrementEmissionMonth(emissionRecord.monthsReleased + 1);    //[DB]
    await logEmissionEvent(monthlyRelease, emissionRecord.monthsReleased + 1, new Date()); //[DB]

    logger.info(`[JOB#9] Month ${emissionRecord.monthsReleased + 1}/25 — Released ${monthlyRelease.toFixed(2)} TSC into circulation.`);
  } catch (err) {
    logger.error("[JOB#9] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #10 — 90-Day Vesting Linear Release (20% withheld tranche)
// Schedule: every day at 03:00 UTC
// Logic:
//   When a user withdraws TSC:
//     80% is sent immediately (handled in withdrawal API, not here).
//     20% is split into 90 equal daily instalments.
//   This job credits each user's daily vesting instalment.
//   Each vesting record tracks: userId, totalVested, released, startDate.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 3 * * *", async () => {
  logger.info("[JOB#10] Starting: 90-Day Vesting Linear Release");
  try {
    const today = new Date();

    // Each record: { vestingId, userId, totalVestedAmount, releasedAmount, startDate, daysCredited }
    const activeVestings = await getActiveVestingRecords(); //[DB] where daysCredited < 90

    for (const v of activeVestings) {
      if (v.daysCredited >= CONFIG.WITHDRAWAL_VESTING_DAYS) continue;

      const dailyInstalment = new Decimal(v.totalVestedAmount).div(CONFIG.WITHDRAWAL_VESTING_DAYS);
      await creditTSCToUser(v.userId, dailyInstalment, "VESTING_RELEASE"); //[DB]
      await incrementVestingDaysCredited(v.vestingId);                     //[DB]

      if (v.daysCredited + 1 >= CONFIG.WITHDRAWAL_VESTING_DAYS) {
        await markVestingComplete(v.vestingId); //[DB]
        logger.info(`[JOB#10] Vesting complete for user ${v.userId}, vestingId ${v.vestingId}`);
      }
    }

    logger.info(`[JOB#10] Done. Processed ${activeVestings.length} active vesting records.`);
  } catch (err) {
    logger.error("[JOB#10] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #11 — Post-TSC Pool Multiplier Upgrade (One-time trigger)
// Schedule: check every day at 00:00 UTC
// Logic:
//   Poll for TSC launch event flag.
//   When found, upgrade ALL staked NFT pool multipliers to post-TSC values.
//   Self-disables after execution by setting a permanent flag.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 0 * * *", async () => {
  logger.info("[JOB#11] Checking: Post-TSC Pool Multiplier Upgrade");
  try {
    const alreadyUpgraded = await isPoolMultiplierUpgradeDone(); //[DB] boolean flag
    if (alreadyUpgraded) return; // already done — silent exit

    const tscLaunched = await isTSCLaunched(); //[DB] boolean flag set by launch event
    if (!tscLaunched) {
      logger.info("[JOB#11] TSC not yet launched — waiting.");
      return;
    }

    // Upgrade all NFT records
    for (const [level, tier] of Object.entries(CONFIG.NFT_TIERS)) {
      await updateAllNFTPoolMultipliersByLevel(level, tier.poolMultiplierAfterTSC.toNumber()); //[DB]
      logger.info(`[JOB#11] Upgraded ${level} pool multiplier → ${tier.poolMultiplierAfterTSC}×`);
    }

    await setPoolMultiplierUpgradeDone(true); //[DB] prevent re-run
    logger.info("[JOB#11] Pool multiplier upgrade complete for all NFT tiers.");
  } catch (err) {
    logger.error("[JOB#11] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL API HELPER (call this from withdrawal endpoint, not a cron)
// Handles the real-time withdrawal split + fee collection for Jobs #6 & #10
// ─────────────────────────────────────────────────────────────────────────────
async function processTSCWithdrawal(userId, requestedAmount) {
  const amount = new Decimal(requestedAmount);

  // 1. Deduct 2% fee → airdrop pool
  const fee            = amount.times(CONFIG.WITHDRAWAL_FEE_PCT);
  const amountAfterFee = amount.minus(fee);
  await addToAirdropPool(fee); //[DB]

  // 2. 80% instant credit
  const instantAmount  = amountAfterFee.times(CONFIG.WITHDRAWAL_INSTANT_PCT);
  await creditTSCToUser(userId, instantAmount, "WITHDRAWAL_INSTANT"); //[DB]

  // 3. 20% vesting record (Job #10 picks this up daily)
  const vestedAmount   = amountAfterFee.times(CONFIG.WITHDRAWAL_VESTING_PCT);
  await createVestingRecord({                //[DB]
    userId,
    totalVestedAmount: vestedAmount.toNumber(),
    releasedAmount: 0,
    startDate: new Date(),
    daysCredited: 0,
  });

  logger.info(`[WITHDRAWAL] User ${userId}: fee=${fee.toFixed(4)}, instant=${instantAmount.toFixed(4)}, vesting=${vestedAmount.toFixed(4)} TSC`);
  return { fee, instantAmount, vestedAmount };
}

module.exports = { processTSCWithdrawal };


// ─────────────────────────────────────────────────────────────────────────────
// STUB FUNCTIONS — Replace these with actual DB/ORM queries
// ─────────────────────────────────────────────────────────────────────────────
async function getCurrentTSCPrice()               { return 1.0; /* [DB] fallback */ }
async function updateTSCPrice(price)              { return true; /* [DB] fallback */ }
async function isTSCLaunched()                    { return false; /* [DB] fallback */ }
async function getAllStakedNFTs()                  { return []; /* [DB] fallback */ }
async function creditTSCToUser(uid, amt, type)    { return true; /* [DB] fallback */ }
async function logMiningEvent(nftId, amt, date)   { return true; /* [DB] fallback */ }
async function setDailyNetworkMiningTotal(total)  { return true; /* [DB] fallback */ }
async function getDailyNetworkMiningTotal()       { return 0; /* [DB] fallback */ }
async function logPriceHistory(old, nw, rate, d)  { return true; /* [DB] fallback */ }
async function getTodayMinerOutputs()             { return []; /* [DB] fallback */ }
async function getTodayMinerOutputsMap()          { return new Map(); /* [DB] fallback */ }
async function getReferrer(userId)                { return null; /* [DB] fallback */ }
async function getActiveAssistanceRelationships() { return []; /* [DB] fallback */ }
async function getActiveNodeOperators()           { return []; /* [DB] fallback */ }
async function flagNodeThresholdBreach(uid, lvl)  { return true; /* [DB] fallback */ }
async function getAirdropPoolBalance()            { return 0; /* [DB] fallback */ }
async function addToAirdropPool(amount)           { return true; /* [DB] fallback */ }
async function resetAirdropPool()                 { return true; /* [DB] fallback */ }
async function getAllEligibleMiners()              { return []; /* [DB] fallback */ }
async function getAllTSCStakers()                  { return []; /* [DB] fallback */ }
async function getAllTKCStakers()                  { return []; /* [DB] fallback */ }
async function getTotalTKCStaked()                { return 0; /* [DB] fallback */ }
async function getDailyTSCPoolForTKCStakers()     { return 0; /* [DB] fallback */ }
async function getEmissionRecord()                { return { monthsReleased: 0, totalSupply: 100000000 }; /* [DB] fallback */ }
async function releaseTokensToCirculation(amt)    { return true; /* [BLOCKCHAIN] fallback */ }
async function incrementEmissionMonth(month)      { return true; /* [DB] fallback */ }
async function logEmissionEvent(amt, month, date) { return true; /* [DB] fallback */ }
async function getActiveVestingRecords()          { return []; /* [DB] fallback */ }
async function incrementVestingDaysCredited(id)   { return true; /* [DB] fallback */ }
async function markVestingComplete(id)            { return true; /* [DB] fallback */ }
async function createVestingRecord(record)        { return true; /* [DB] fallback */ }
async function isPoolMultiplierUpgradeDone()      { return false; /* [DB] fallback */ }
async function setPoolMultiplierUpgradeDone(val)  { return true; /* [DB] fallback */ }
async function updateAllNFTPoolMultipliersByLevel(level, multiplier) { return true; /* [DB] fallback */ }
