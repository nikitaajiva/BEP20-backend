/**
 * ============================================================
 * TOKINGHOOFBORN — Horse NFT & Token Staking System
 * Cron Jobs: Jobs #12 through #17
 * ============================================================
 *
 * DEPENDENCIES (npm install):
 *   node-cron       — cron scheduling
 *   decimal.js      — precision arithmetic for token math
 *
 * HOW TO PLUG IN:
 *   Replace every call marked //[DB]         with your ORM/DB query.
 *   Replace every call marked //[BLOCKCHAIN] with your Web3/Solana contract call.
 *   Replace every call marked //[NOTIFY]     with your notification/email service.
 *   Replace every call marked //[EXTERNAL]   with your third-party API call.
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
// CONSTANTS
// ─────────────────────────────────────────────
const CONFIG = {
  // Token staking APY bands per lock-up period (as decimals, divide by 365 for daily)
  STAKING_APY: {
    30:  { min: new Decimal("0.05"),  max: new Decimal("0.10") },  //  5–10%
    90:  { min: new Decimal("0.11"),  max: new Decimal("0.12") },  // 11–12%
    180: { min: new Decimal("0.19"),  max: new Decimal("0.22") },  // 19–22%
    365: { min: new Decimal("0.23"),  max: new Decimal("0.28") },  // 23–28%
  },

  // NFT Horse Package tiers
  NFT_PACKAGES: {
    BRONZE: {
      price: 500,
      bonusTokens: 5000,
      maxAnnualROI: new Decimal("0.15"),   // 15%
      dividendFrequencyDays: 90,           // Quarterly
      airdropTier: "BRONZE",
    },
    SILVER: {
      price: 1000,
      bonusTokens: 12000,
      maxAnnualROI: new Decimal("0.25"),   // 25%
      dividendFrequencyDays: 30,           // Monthly
      airdropTier: "BRONZE",              // document says "Bronze Tier Airdrops" for Silver too
    },
    GOLD: {
      price: 5000,
      bonusTokens: 75000,
      maxAnnualROI: new Decimal("0.35"),   // 35%
      dividendFrequencyDays: 7,            // Weekly
      airdropTier: "GOLD",
    },
  },

  // TVL adjustment bounds — APY stays within the band even after adjustment
  TVL_ADJUSTMENT_DAMPENING: new Decimal("0.1"), // max 10% adjustment per cycle
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Compute daily APY reward for a staking position
// Uses midpoint of APY band; can be replaced with governance-set rate.
// ─────────────────────────────────────────────────────────────────────────────
function computeDailyStakingReward(stakedAmount, lockupDays, currentAPY) {
  // currentAPY is a Decimal (e.g. 0.07 for 7%)
  const dailyRate = currentAPY.div(365);
  return new Decimal(stakedAmount).times(dailyRate);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Compute annual dividend for a Horse NFT position
// Revenue streams: race winnings + breeding fees + stud services + sponsorships
// Each horse's actual earnings come from the off-chain revenue oracle / audit.
// ─────────────────────────────────────────────────────────────────────────────
function computeHorseDividend(nftPosition, totalHorseRevenue) {
  // nftPosition.ownershipFraction = how much of the horse this NFT represents
  const holderRevenue = new Decimal(totalHorseRevenue).times(nftPosition.ownershipFraction);
  return holderRevenue;
}


// ─────────────────────────────────────────────────────────────────────────────
// JOB #12 — Token Staking APY Reward Distribution
// Schedule: every day at 01:00 UTC
// Logic:
//   For each active staking position, compute and credit daily APY slice.
//   Uses the current dynamic APY rates (set by Job #17).
//   Only credits if the lock-up period is still active.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 1 * * *", async () => {
  logger.info("[JOB#12] Starting: Token Staking APY Reward Distribution");
  try {
    // Each record: { positionId, userId, stakedAmount, lockupDays, startDate, currentAPY }
    const activePositions = await getActiveStakingPositions(); //[DB]
    const today = new Date();

    for (const pos of activePositions) {
      const lockupEnd = new Date(pos.startDate);
      lockupEnd.setDate(lockupEnd.getDate() + pos.lockupDays);

      // Only distribute during active lock-up period
      if (today > lockupEnd) {
        logger.info(`[JOB#12] Position ${pos.positionId} lock-up expired — skipping reward.`);
        continue;
      }

      const currentAPY = new Decimal(pos.currentAPY); // pulled from DB, set by Job #17
      const dailyReward = computeDailyStakingReward(pos.stakedAmount, pos.lockupDays, currentAPY);

      await creditTokensToUser(pos.userId, dailyReward, "STAKING_APY_REWARD"); //[DB]
      await logStakingReward(pos.positionId, dailyReward, today);              //[DB]
    }

    logger.info(`[JOB#12] Done. APY rewards distributed for ${activePositions.length} staking positions.`);
  } catch (err) {
    logger.error("[JOB#12] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #13 — Lock-up Period Expiry Check
// Schedule: every day at 01:30 UTC (after Job #12)
// Logic:
//   Scan all staking positions.
//   If lock-up period has elapsed: mark as withdrawable, stop reward accrual,
//   notify the user, and log the event.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("30 1 * * *", async () => {
  logger.info("[JOB#13] Starting: Lock-up Period Expiry Check");
  try {
    const today = new Date();
    const activePositions = await getActiveStakingPositions(); //[DB]
    let expiredCount = 0;

    for (const pos of activePositions) {
      const lockupEnd = new Date(pos.startDate);
      lockupEnd.setDate(lockupEnd.getDate() + pos.lockupDays);

      if (today >= lockupEnd) {
        await markPositionWithdrawable(pos.positionId);   //[DB] set status = 'WITHDRAWABLE'
        await stopRewardAccrual(pos.positionId);          //[DB] flag to skip in future Job #12 runs
        await notifyUserLockupExpired(pos.userId, pos);   //[NOTIFY] email / push / in-app
        expiredCount++;
        logger.info(`[JOB#13] Position ${pos.positionId} for user ${pos.userId} is now withdrawable.`);
      }
    }

    logger.info(`[JOB#13] Done. ${expiredCount} positions marked withdrawable out of ${activePositions.length}.`);
  } catch (err) {
    logger.error("[JOB#13] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #14 — Horse NFT Dividend Distribution
// Schedule: every day at 02:00 UTC
//   This job runs daily but only pays out based on each tier's frequency:
//     GOLD   → every 7 days  (weekly)
//     SILVER → every 30 days (monthly)
//     BRONZE → every 90 days (quarterly)
//   Revenue data comes from the monthly third-party audit (Job #15).
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 2 * * *", async () => {
  logger.info("[JOB#14] Starting: Horse NFT Dividend Distribution");
  try {
    const today = new Date();

    // Each record: { nftId, userId, tier, horseId, ownershipFraction, lastPaidDate }
    const horseNFTHolders = await getAllHorseNFTHolders(); //[DB]

    for (const holder of horseNFTHolders) {
      const tierConfig = CONFIG.NFT_PACKAGES[holder.tier];
      if (!tierConfig) continue;

      // Check if payment is due based on tier frequency
      const daysSinceLastPaid = Math.floor(
        (today - new Date(holder.lastPaidDate)) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceLastPaid < tierConfig.dividendFrequencyDays) continue;

      // Fetch the horse's accumulated revenue for the period
      const horseRevenue = await getHorseRevenueForPeriod(
        holder.horseId,
        holder.lastPaidDate,
        today
      ); //[DB] populated by Job #15 audit sync

      if (!horseRevenue || new Decimal(horseRevenue).lte(0)) {
        logger.warn(`[JOB#14] No revenue available for horse ${holder.horseId} — skipping.`);
        continue;
      }

      const dividend = computeHorseDividend(holder, horseRevenue);

      // Apply max ROI cap on annualised basis
      const annualizedDividend = dividend.times(365).div(tierConfig.dividendFrequencyDays);
      const investedAmount = new Decimal(tierConfig.price);
      const annualROIPct = annualizedDividend.div(investedAmount);

      const cappedDividend = annualROIPct.gt(tierConfig.maxAnnualROI)
        ? investedAmount.times(tierConfig.maxAnnualROI).times(tierConfig.dividendFrequencyDays).div(365)
        : dividend;

      await creditTokensToUser(holder.userId, cappedDividend, `HORSE_DIVIDEND_${holder.tier}`); //[DB]
      await updateNFTLastPaidDate(holder.nftId, today);                                         //[DB]
      await logDividendPayment(holder.nftId, holder.horseId, cappedDividend, today);            //[DB]
    }

    logger.info(`[JOB#14] Done. Dividend distribution complete for ${horseNFTHolders.length} NFT holders.`);
  } catch (err) {
    logger.error("[JOB#14] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #15 — Monthly Third-Party Audit Report Sync
// Schedule: 2nd of every month at 04:00 UTC
//   (1st is TSC emission day — offset to avoid conflicts)
// Logic:
//   Pull audit data from third-party accounting integration.
//   Update each horse's earnings record in the DB.
//   Push summary to transparency dashboard and blockchain explorer.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 4 2 * *", async () => {
  logger.info("[JOB#15] Starting: Monthly Third-Party Audit Report Sync");
  try {
    // Fetch audit report from third-party provider
    const auditReport = await fetchThirdPartyAuditReport(); //[EXTERNAL] accounting API
    if (!auditReport) {
      logger.error("[JOB#15] No audit report received — aborting.");
      return;
    }

    // auditReport.horses: [{ horseId, racingEarnings, breedingFees, studServices, sponsorships }]
    for (const horse of auditReport.horses) {
      const totalEarnings = new Decimal(horse.racingEarnings)
        .plus(horse.breedingFees)
        .plus(horse.studServices)
        .plus(horse.sponsorships);

      await updateHorseEarningsRecord({        //[DB]
        horseId: horse.horseId,
        period: auditReport.period,            // e.g. "2026-05"
        racingEarnings: horse.racingEarnings,
        breedingFees: horse.breedingFees,
        studServices: horse.studServices,
        sponsorships: horse.sponsorships,
        totalEarnings: totalEarnings.toNumber(),
        auditedAt: new Date(),
      });
    }

    // Push summary metrics to the transparency dashboard
    await updateTransparencyDashboard({        //[DB] / [BLOCKCHAIN]
      auditPeriod: auditReport.period,
      totalHorses: auditReport.horses.length,
      totalNetworkEarnings: auditReport.totalNetworkEarnings,
      auditedAt: new Date(),
      auditReportUrl: auditReport.reportUrl,  // link to PDF or IPFS hash
    });

    // Publish on-chain audit hash for transparency
    await publishAuditHashOnChain(auditReport.reportHash); //[BLOCKCHAIN] Solana tx

    logger.info(`[JOB#15] Done. Audit synced for ${auditReport.horses.length} horses. Period: ${auditReport.period}`);
  } catch (err) {
    logger.error("[JOB#15] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #16 — Airdrop Campaign Distribution
// Schedule: every day at 03:00 UTC
//   Checks for active campaigns and distributes to eligible NFT holders.
//   Campaigns have: startDate, endDate, totalPool, eligibleTiers, allocationMode.
//   allocationMode: 'EQUAL' (split evenly) | 'WEIGHTED' (by NFT count/tier value)
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 3 * * *", async () => {
  logger.info("[JOB#16] Starting: Airdrop Campaign Distribution");
  try {
    const today = new Date();

    // Fetch all campaigns currently in their active window
    const activeCampaigns = await getActiveCampaigns(today); //[DB]

    for (const campaign of activeCampaigns) {
      logger.info(`[JOB#16] Processing campaign: ${campaign.campaignId} (${campaign.name})`);

      // Get all NFT holders of eligible tiers for this campaign
      // campaign.eligibleTiers: e.g. ['BRONZE'] or ['GOLD'] or ['BRONZE','SILVER','GOLD']
      const eligibleHolders = await getHoldersByTiers(campaign.eligibleTiers); //[DB]

      if (!eligibleHolders.length) {
        logger.info(`[JOB#16] No eligible holders for campaign ${campaign.campaignId}`);
        continue;
      }

      // Compute today's campaign budget (totalPool / campaign duration in days)
      const campaignDurationDays = Math.max(1, Math.ceil(
        (new Date(campaign.endDate) - new Date(campaign.startDate)) / (1000 * 60 * 60 * 24)
      ));
      const dailyBudget = new Decimal(campaign.totalPool).div(campaignDurationDays);

      if (campaign.allocationMode === "EQUAL") {
        // Split daily budget evenly across all eligible holders
        const perHolder = dailyBudget.div(eligibleHolders.length);
        for (const holder of eligibleHolders) {
          await creditTokensToUser(holder.userId, perHolder, `AIRDROP_${campaign.campaignId}`); //[DB]
        }
      } else if (campaign.allocationMode === "WEIGHTED") {
        // Weight by tier value: GOLD > SILVER > BRONZE
        const tierWeights = { BRONZE: 1, SILVER: 2, GOLD: 5 };
        let totalWeight = new Decimal(0);

        const weighted = eligibleHolders.map((h) => {
          const w = new Decimal(tierWeights[h.tier] || 1).times(h.nftCount || 1);
          totalWeight = totalWeight.plus(w);
          return { ...h, weight: w };
        });

        for (const holder of weighted) {
          if (totalWeight.eq(0)) break;
          const share = dailyBudget.times(holder.weight.div(totalWeight));
          await creditTokensToUser(holder.userId, share, `AIRDROP_${campaign.campaignId}`); //[DB]
        }
      }

      await logCampaignDistribution(campaign.campaignId, dailyBudget, eligibleHolders.length, today); //[DB]

      // Auto-close campaign if end date reached
      if (today >= new Date(campaign.endDate)) {
        await markCampaignComplete(campaign.campaignId); //[DB]
        logger.info(`[JOB#16] Campaign ${campaign.campaignId} completed and closed.`);
      }
    }

    logger.info(`[JOB#16] Done. Processed ${activeCampaigns.length} active campaigns.`);
  } catch (err) {
    logger.error("[JOB#16] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// JOB #17 — Dynamic APY Rate Adjustment
// Schedule: every Sunday at 00:00 UTC (weekly adjustment cycle)
// Logic:
//   APY rates adjust dynamically based on:
//     1. Total Value Locked (TVL) — higher TVL → lower APY (dilution)
//     2. Platform performance — revenue above target → higher APY band
//   Rates are clamped within the defined band per lock-up period.
//   Updated rates are stored in DB and picked up by Job #12.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule("0 0 * * 0", async () => {
  logger.info("[JOB#17] Starting: Dynamic APY Rate Adjustment");
  try {
    const currentTVL       = await getCurrentTVL();             //[DB] staked token value in USDT
    const targetTVL        = await getTargetTVL();              //[DB] target
    const platformRevenue  = await getWeeklyPlatformRevenue();  //[DB] marketplace
    const revenueTarget    = await getWeeklyRevenueTarget();    //[DB] target

    // Compute TVL pressure factor: >1 means TVL above target → reduce APY
    const tvlFactor      = new Decimal(currentTVL).div(targetTVL || 1);
    // Compute revenue factor: >1 means revenue above target → increase APY
    const revenueFactor  = new Decimal(platformRevenue).div(revenueTarget || 1);

    // Net adjustment: positive = APY goes up, negative = APY goes down
    const netFactor = revenueFactor.minus(tvlFactor); // e.g. +0.2 → revenue doing well
    const dampened  = netFactor.times(CONFIG.TVL_ADJUSTMENT_DAMPENING); // scaled

    for (const [lockupDays, band] of Object.entries(CONFIG.STAKING_APY)) {
      const bandWidth   = band.max.minus(band.min);
      const midPoint    = band.min.plus(bandWidth.div(2));

      // New APY = midpoint ± dampened adjustment, clamped to band
      let newAPY = midPoint.plus(dampened.times(bandWidth));
      newAPY = Decimal.max(band.min, Decimal.min(band.max, newAPY));

      await updateCurrentAPYForLockup(Number(lockupDays), newAPY); //[DB]
      logger.info(`[JOB#17] ${lockupDays}-day lock APY updated to ${newAPY.times(100).toFixed(2)}%`);
    }

    // Update all active staking positions with new APY for their lock-up tier
    const activePositions = await getActiveStakingPositions(); //[DB]
    for (const pos of activePositions) {
      const newAPY = await getCurrentAPYForLockup(pos.lockupDays); //[DB]
      await updatePositionAPY(pos.positionId, newAPY);             //[DB]
    }

    await logAPYAdjustmentEvent({                 //[DB]
      tvlFactor:     tvlFactor.toNumber(),
      revenueFactor: revenueFactor.toNumber(),
      adjustedAt:    new Date(),
    });

    logger.info("[JOB#17] Done. APY rates adjusted for all lock-up tiers.");
  } catch (err) {
    logger.error("[JOB#17] Error:", err);
  }
}, { timezone: "UTC" });


// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL API HELPER — Hoofborn Token Staking
// Call this from withdrawal endpoint, not a cron.
// After lock-up: full amount is withdrawable, rewards stop accruing.
// ─────────────────────────────────────────────────────────────────────────────
async function processHoofbornTokenWithdrawal(userId, positionId) {
  const position = await getStakingPosition(positionId); //[DB]
  if (!position || position.userId !== userId) {
    throw new Error("Position not found or unauthorized.");
  }
  if (position.status !== "WITHDRAWABLE") {
    throw new Error("Lock-up period has not yet elapsed.");
  }

  // Return full principal + accumulated rewards
  const totalReturn = new Decimal(position.stakedAmount).plus(position.accumulatedRewards);
  await creditTokensToUser(userId, totalReturn, "STAKING_WITHDRAWAL"); //[DB]
  await markPositionClosed(positionId);                                //[DB]

  logger.info(`[WITHDRAWAL:HOOFBORN] User ${userId} withdrew position ${positionId}: ${totalReturn.toFixed(4)} tokens`);
  return { totalReturn };
}

module.exports = { processHoofbornTokenWithdrawal };


// ─────────────────────────────────────────────────────────────────────────────
// STUB FUNCTIONS — Replace with actual DB/ORM queries
// ─────────────────────────────────────────────────────────────────────────────
async function getActiveStakingPositions()                       { return []; /* [DB] fallback */ }
async function creditTokensToUser(uid, amt, type)               { return true; /* [DB] fallback */ }
async function logStakingReward(posId, amt, date)               { return true; /* [DB] fallback */ }
async function markPositionWithdrawable(posId)                   { return true; /* [DB] fallback */ }
async function stopRewardAccrual(posId)                          { return true; /* [DB] fallback */ }
async function notifyUserLockupExpired(uid, pos)                 { return true; /* [NOTIFY] fallback */ }
async function getAllHorseNFTHolders()                            { return []; /* [DB] fallback */ }
async function getHorseRevenueForPeriod(hId, from, to)          { return 0; /* [DB] fallback */ }
async function updateNFTLastPaidDate(nftId, date)               { return true; /* [DB] fallback */ }
async function logDividendPayment(nftId, hId, amt, date)        { return true; /* [DB] fallback */ }
async function fetchThirdPartyAuditReport()                      { return null; /* [EXTERNAL] fallback */ }
async function updateHorseEarningsRecord(data)                   { return true; /* [DB] fallback */ }
async function updateTransparencyDashboard(data)                 { return true; /* [DB] fallback */ }
async function publishAuditHashOnChain(hash)                     { return true; /* [BLOCKCHAIN] fallback */ }
async function getActiveCampaigns(date)                          { return []; /* [DB] fallback */ }
async function getHoldersByTiers(tiers)                          { return []; /* [DB] fallback */ }
async function logCampaignDistribution(cId, budget, n, date)    { return true; /* [DB] fallback */ }
async function markCampaignComplete(campaignId)                  { return true; /* [DB] fallback */ }
async function getCurrentTVL()                                   { return 1000000; /* [DB] fallback */ }
async function getTargetTVL()                                    { return 1000000; /* [DB] fallback */ }
async function getWeeklyPlatformRevenue()                        { return 50000; /* [DB] fallback */ }
async function getWeeklyRevenueTarget()                          { return 50000; /* [DB] fallback */ }
async function updateCurrentAPYForLockup(days, apy)             { return true; /* [DB] fallback */ }
async function getCurrentAPYForLockup(days)                      { return new Decimal("0.05"); /* [DB] fallback */ }
async function updatePositionAPY(posId, apy)                    { return true; /* [DB] fallback */ }
async function logAPYAdjustmentEvent(data)                       { return true; /* [DB] fallback */ }
async function getStakingPosition(posId)                         { return null; /* [DB] fallback */ }
async function markPositionClosed(posId)                         { return true; /* [DB] fallback */ }
