const mongoose = require('mongoose');

const GlobalConfigSchema = new mongoose.Schema({
  token_config: {
    total_supply: { type: Number, default: 2000000000 },
    token_price: { type: Number, default: 0.01 },
    network: { type: String, default: "Solana" }
  },
  staking_tiers: {
    "30": { min_apy: Number, max_apy: Number },
    "90": { min_apy: Number, max_apy: Number },
    "180": { min_apy: Number, max_apy: Number },
    "365": { min_apy: Number, max_apy: Number }
  },
  nft_packages: {
    bronze: {
      price: Number,
      bonus_tokens: Number,
      max_roi_pct: Number,
      dividend_freq: String
    },
    silver: {
      price: Number,
      bonus_tokens: Number,
      max_roi_pct: Number,
      dividend_freq: String
    },
    gold: {
      price: Number,
      bonus_tokens: Number,
      max_roi_pct: Number,
      dividend_freq: String
    }
  },
  referral_config: {
    levels: { type: Number, default: 5 },
    rates: {
      L1: Number,
      L2: Number,
      L3: Number,
      L4: Number,
      L5: Number
    },
    eligibility: String
  },
  nft_mint_tiers: [{
    tier: String,
    price: Number,
    power: Number,
    coeff: Number,
    mult: Number,
    post: Number
  }],
  mining_config: {
    daily_output_min_pct: Number,
    daily_output_max_pct: Number,
    ref_l1_pct: Number,
    ref_l2_pct: Number,
    assistance_pct: Number,
    withdrawal_fee_pct: Number
  },
  tsc_pricing: {
    initial_price: Number,
    daily_increase_min_pct: Number,
    daily_increase_max_pct: Number,
    release_months: Number,
    monthly_emission_pct: Number,
    swap_fee_pct: Number
  },
  withdrawal_config: {
    instant_pct: Number,
    vest_pct: Number,
    vest_days: Number,
    withdrawal_fee_pct: Number
  },
  node_tiers: [{
    node: String,
    upg: Number,
    total: mongoose.Schema.Types.Mixed,
    mining: Number,
    airdrop: Number
  }],
  dashboard_defaults: {
    default_staking: Number,
    default_lockup: Number,
    default_nft_package: String,
    default_l1_referrals: Number,
    avg_l1_investment: Number,
    avg_l2_referrals: Number
  }
}, { timestamps: true });

module.exports = mongoose.model('GlobalConfig', GlobalConfigSchema);
