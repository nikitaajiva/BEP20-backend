const mongoose = require('mongoose');

const ProtocolConfigSchema = new mongoose.Schema({
  key: { 
    type: String, 
    unique: true, 
    default: "default",
    required: true
  },
  tscInitialPriceUSDT: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("2") 
  },
  tscDailyIncreasePercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("0.2") 
  },
  tscDailyIncreaseMinPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("0.2") 
  },
  tscDailyIncreaseMaxPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("0.5") 
  },
  tscReleaseMonths: { 
    type: Number, 
    default: 25 
  },
  monthlyEmissionPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("4") 
  },
  tscWithdrawalFeePercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("3") 
  },
  tscWithdrawalInstantPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("80") 
  },
  tscWithdrawalVestingPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("20") 
  },
  tscVestingDays: { 
    type: Number, 
    default: 90 
  },
  tscToTkcSwapFeePercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("3") 
  },
  referralLevel1Percent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("10") 
  },
  referralLevel2Percent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("5") 
  },
  assistanceRewardPercent: { 
    type: mongoose.Schema.Types.Decimal128, 
    default: mongoose.Types.Decimal128.fromString("10") 
  },
  isTscLaunched: { 
    type: Boolean, 
    default: false 
  },
  tscLaunchDate: { 
    type: Date 
  },
  updatedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { timestamps: true });

module.exports = mongoose.models.ProtocolConfig || mongoose.model('ProtocolConfig', ProtocolConfigSchema);
