const GlobalConfig = require('../models/GlobalConfig');

const defaultConfig = {
  token_config: { total_supply: 2000000000, token_price: 0.01, network: "Solana" },
  staking_tiers: {
    "30": { min_apy: 5, max_apy: 10 },
    "90": { min_apy: 11, max_apy: 18 },
    "180": { min_apy: 19, max_apy: 22 },
    "365": { min_apy: 23, max_apy: 28 }
  },
  nft_packages: {
    bronze: { price: 500, bonus_tokens: 5000, max_roi_pct: 15, dividend_freq: "Quarterly" },
    silver: { price: 1000, bonus_tokens: 12000, max_roi_pct: 25, dividend_freq: "Monthly" },
    gold: { price: 5000, bonus_tokens: 75000, max_roi_pct: 35, dividend_freq: "Weekly" }
  },
  referral_config: {
    levels: 5,
    rates: { L1: 10, L2: 5, L3: 3, L4: 2, L5: 1 },
    eligibility: "Must hold minimum Basic Package"
  },
  nft_mint_tiers: [
    { tier: "N1", price: 100, power: 100, coeff: 0.7, mult: 2, post: 2.5 },
    { tier: "N2", price: 500, power: 500, coeff: 0.8, mult: 2, post: 2.8 },
    { tier: "N3", price: 1000, power: 1000, coeff: 0.9, mult: 2, post: 3 },
    { tier: "N4", price: 3000, power: 3000, coeff: 1, mult: 2, post: 3.5 },
    { tier: "N5", price: 10000, power: 10000, coeff: 1.1, mult: 2, post: 4 }
  ],
  mining_config: {
    daily_output_min_pct: 0.5, daily_output_max_pct: 1.5,
    ref_l1_pct: 10, ref_l2_pct: 5, assistance_pct: 10, withdrawal_fee_pct: 2
  },
  tsc_pricing: {
    initial_price: 2, daily_increase_min_pct: 0.2, daily_increase_max_pct: 0.5,
    release_months: 25, monthly_emission_pct: 4, swap_fee_pct: 3
  },
  withdrawal_config: {
    instant_pct: 80, vest_pct: 20, vest_days: 90, withdrawal_fee_pct: 3
  },
  node_tiers: [
    { node: "P1", upg: 1, total: 3, mining: 10, airdrop: 20 },
    { node: "P2", upg: 5, total: 10, mining: 20, airdrop: 15 },
    { node: "P3", upg: 15, total: 30, mining: 30, airdrop: 12.5 },
    { node: "P4", upg: 50, total: 100, mining: 40, airdrop: 11.5 },
    { node: "P5", upg: 150, total: 300, mining: 50, airdrop: 10.5 },
    { node: "P6", upg: 350, total: 700, mining: 60, airdrop: 9.5 },
    { node: "P7", upg: 800, total: 1600, mining: 70, airdrop: 8.5 },
    { node: "P8", upg: 1600, total: 3200, mining: 80, airdrop: 7.5 },
    { node: "P9", upg: 3000, total: "2xP8", mining: 90, airdrop: 5 }
  ],
  dashboard_defaults: {
    default_staking: 5000, default_lockup: 180, default_nft_package: "silver",
    default_l1_referrals: 5, avg_l1_investment: 1000, avg_l2_referrals: 10
  }
};

exports.getConfig = async (req, res) => {
  try {
    console.log(`[CONFIG] Fetch requested by user: ${req.user?._id} (Role: ${req.user?.userType})`);
    let config = await GlobalConfig.findOne();
    if (!config) {
      console.log("[CONFIG] No config found, creating default...");
      config = await GlobalConfig.create(defaultConfig);
    }
    res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("[CONFIG] Fetch error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    console.log(`[CONFIG] Update requested by user: ${req.user?._id} (Role: ${req.user?.userType})`);
    let config = await GlobalConfig.findOne();
    if (config) {
      config = await GlobalConfig.findByIdAndUpdate(config._id, req.body, { new: true });
    } else {
      config = await GlobalConfig.create(req.body);
    }
    res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("[CONFIG] Update error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
