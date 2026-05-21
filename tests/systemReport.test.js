const mongoose = require('mongoose');
const Ledger = require('../models/Ledger');
const LedgerRow = require('../models/LedgerRow');
const ChainDeposit = require('../models/ChainDeposit');
const ChainWithdrawal = require('../models/ChainWithdrawal');
const X1Reward = require('../models/X1Reward');
const CommunityBoosterReward = require('../models/CommunityBoosterReward');
const { getSystemReport } = require('../controllers/supportController');

// Helper for approximate equality (defaults to 1% tolerance)
const approxEqual = (a, b, pct = 0.01) => {
  a = Number(a);
  b = Number(b);
  if (!isFinite(a) || !isFinite(b)) return false;
  const diff = Math.abs(a - b);
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / base <= pct;
};

describe('System Report', () => {
  beforeAll(async () => {
    jest.setTimeout(30000);
    await mongoose.connect('mongodb://127.0.0.1/xrpmigrate');
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('should return numbers close to live aggregates', async () => {
    // --- Expected values -------------------------------------------------
    const [agg = {}] = await Ledger.aggregate([
      {
        $group: {
          _id: null,
          totalPositiveLP: {
            $sum: { $cond: [{ $gt: ['$wallets.lp', 0] }, '$wallets.lp', 0] },
          },
          totalNegativeLP: {
            $sum: { $cond: [{ $lt: ['$wallets.lp', 0] }, '$wallets.lp', 0] },
          },
          totalLP: { $sum: '$wallets.lp' },
          totalAirdrop: { $sum: '$wallets.airdrop' },
          totalBooster: { $sum: '$wallets.boost' },
          totalXaman: { $sum: '$wallets.xaman' },
          totalZeroRisk: { $sum: '$wallets.zeroRisk' },
          total5xUsed: { $sum: '$limits.fiveXLimit.used' },
          totalCascade: { $sum: '$wallets.cascadeRewards' },
        },
      },
    ]);

    const [{ total: onChainDeposits = 0 } = {}] = await ChainDeposit.aggregate([
      { $group: { _id: null, total: { $sum: '$amountXRP' } } },
    ]);

    const [{ total: onChainWithdrawals = 0 } = {}] = await ChainWithdrawal.aggregate([
      { $group: { _id: null, total: { $sum: '$amountXRP' } } },
    ]);

    const distAgg = await LedgerRow.aggregate([
      {
        $match: {
          eventType: {
            $in: ['DAILY_REWARDS_LP', 'DAILY_REWARDS_AIRDROP', 'DAILY_REWARDS_BOOST'],
          },
        },
      },
      { $group: { _id: '$eventType', total: { $sum: '$amount' } } },
    ]);

    const distributedLp = distAgg.find((d) => d._id === 'DAILY_REWARDS_LP')?.total || 0;
    const distributedAirdrop = distAgg.find((d) => d._id === 'DAILY_REWARDS_AIRDROP')?.total || 0;
    const distributedBooster = distAgg.find((d) => d._id === 'DAILY_REWARDS_BOOST')?.total || 0;

    const [{ total: xBonusTotal = 0 } = {}] = await X1Reward.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const [{ total: communityBoosterTotal = 0 } = {}] = await CommunityBoosterReward.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // --- Call API --------------------------------------------------------
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await getSystemReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    const report = payload.data;

    // --- Assertions (1% tolerance) --------------------------------------
    expect(approxEqual(report.totalPositiveLP, agg.totalPositiveLP)).toBe(true);
    expect(approxEqual(report.totalNegativeLP, agg.totalNegativeLP)).toBe(true);
    expect(approxEqual(report.totalLP, agg.totalLP)).toBe(true);
    expect(approxEqual(report.totalAirdrop, agg.totalAirdrop)).toBe(true);
    expect(approxEqual(report.totalBooster, agg.totalBooster)).toBe(true);
    expect(approxEqual(report.totalXaman, agg.totalXaman)).toBe(true);
    expect(approxEqual(report.totalZeroRisk, agg.totalZeroRisk)).toBe(true);
    expect(approxEqual(report.total5xUsed, agg.total5xUsed)).toBe(true);
    expect(approxEqual(report.totalCascadeRewards, agg.totalCascade)).toBe(true);

    expect(approxEqual(report.onChainDeposits, onChainDeposits)).toBe(true);
    expect(approxEqual(report.onChainWithdrawals, onChainWithdrawals)).toBe(true);

    expect(approxEqual(report.distributedLpRewards, distributedLp)).toBe(true);
    expect(approxEqual(report.distributedAirdropRewards, distributedAirdrop)).toBe(true);
    expect(approxEqual(report.distributedBoosterRewards, distributedBooster)).toBe(true);

    expect(approxEqual(report.totalX1Rewards, xBonusTotal)).toBe(true);
    expect(approxEqual(report.totalCommunityBoosterRewards, communityBoosterTotal)).toBe(true);
  }, 30000);
}); 
