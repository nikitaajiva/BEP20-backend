/**
 * ============================================================
 * MASTER CRON BOOTSTRAP — index.js
 * Starts all 17 cron jobs for both TokingGold and Hoofborn.
 *
 * USAGE:
 *   node index.js                  (standalone)
 *   require('./index')             (import into your Express app)
 *
 * npm install: node-cron decimal.js winston
 * ============================================================
 */

require("./tokinggold.crons"); // Jobs #1–#11  (TSC NFT Ecosystem)
require("./hoofborn.crons");   // Jobs #12–#17 (Horse NFT & Staking)

console.log(`
╔══════════════════════════════════════════════════════════╗
║         ALL 17 CRON JOBS REGISTERED & RUNNING           ║
╠══════════════════════════════════════════════════════════╣
║  TokingGold / TSC System                                ║
║  ── #1  Daily NFT Mining Output         00:01 UTC daily ║
║  ── #2  TSC Price Appreciation          00:05 UTC daily ║
║  ── #3  Referral Reward Distribution    00:15 UTC daily ║
║  ── #4  Node P1–P9 Reward Distribution  00:20 UTC daily ║
║  ── #5  Assistance Reward Distribution  00:25 UTC daily ║
║  ── #6  Airdrop Pool Distribution       01:00 UTC daily ║
║  ── #7  TSC Re-staking Compounding      00:30 UTC daily ║
║  ── #8  TKC Staking → TSC Rewards       00:35 UTC daily ║
║  ── #9  Monthly TSC Emission Release    02:00  1st/mth  ║
║  ── #10 90-Day Vesting Linear Release   03:00 UTC daily ║
║  ── #11 Post-TSC Multiplier Upgrade     00:00 UTC daily ║
╠══════════════════════════════════════════════════════════╣
║  TokingHoofborn System                                  ║
║  ── #12 Token Staking APY Distribution  01:00 UTC daily ║
║  ── #13 Lock-up Period Expiry Check     01:30 UTC daily ║
║  ── #14 Horse NFT Dividend Distribution 02:00 UTC daily ║
║  ── #15 Monthly Audit Report Sync       04:00  2nd/mth  ║
║  ── #16 Airdrop Campaign Distribution   03:00 UTC daily ║
║  ── #17 Dynamic APY Rate Adjustment     00:00 UTC Sun   ║
╚══════════════════════════════════════════════════════════╝
`);
