const mongoose = require('mongoose');
const ProtocolConfig = require('../models/ProtocolConfig');
const NftTier = require('../models/NftTier');
const NodeLevelConfig = require('../models/NodeLevelConfig');

// Helper to convert mongoose/mongodb Decimal128 values to strings recursively
const formatDecimals = (obj) => {
  if (obj === null || obj === undefined) return obj;

  // Handle Mongoose Document
  if (typeof obj.toJSON === 'function') {
    obj = obj.toJSON();
  }

  // Handle Decimal128 directly
  if (obj._bsontype === 'Decimal128' || obj.constructor?.name === 'Decimal128') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(formatDecimals);
  }

  if (typeof obj === 'object') {
    const formatted = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (val && (val._bsontype === 'Decimal128' || val.constructor?.name === 'Decimal128')) {
          formatted[key] = val.toString();
        } else if (typeof val === 'object') {
          formatted[key] = formatDecimals(val);
        } else {
          formatted[key] = val;
        }
      }
    }
    return formatted;
  }

  return obj;
};

// Safe parse number to Decimal128
const toDecimal128 = (val) => {
  if (val === undefined || val === null) return null;
  return mongoose.Types.Decimal128.fromString(String(val));
};

// Convert decimal to number safely for validation
const toNum = (val) => {
  if (val === undefined || val === null) return NaN;
  if (val._bsontype === 'Decimal128' || val.constructor?.name === 'Decimal128') {
    return Number(val.toString());
  }
  return Number(val);
};

// GET /api/admin/protocol/config
exports.getProtocolConfig = async (req, res) => {
  try {
    let config = await ProtocolConfig.findOne({ key: 'default' });
    if (!config) {
      config = new ProtocolConfig({ key: 'default' });
      await config.save();
    }
    res.status(200).json({
      success: true,
      data: formatDecimals(config)
    });
  } catch (error) {
    console.error('Error fetching protocol config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch protocol config',
      error: error.message
    });
  }
};

// PUT /api/admin/protocol/config
exports.updateProtocolConfig = async (req, res) => {
  try {
    let config = await ProtocolConfig.findOne({ key: 'default' });
    if (!config) {
      config = new ProtocolConfig({ key: 'default' });
    }

    const updates = req.body;
    
    // Percentage fields to validate (must be between 0 and 100)
    const percentageFields = [
      'monthlyEmissionPercent',
      'tscWithdrawalFeePercent',
      'tscWithdrawalInstantPercent',
      'tscWithdrawalVestingPercent',
      'tscToTkcSwapFeePercent',
      'referralLevel1Percent',
      'referralLevel2Percent',
      'assistanceRewardPercent'
    ];

    // Decimal positive rate/coefficient fields (must be >= 0)
    const positiveOrZeroDecimalFields = [
      'tscDailyIncreasePercent',
      'tscDailyIncreaseMinPercent',
      'tscDailyIncreaseMaxPercent'
    ];

    // 1. Validate percentages
    for (const field of percentageFields) {
      if (updates[field] !== undefined) {
        const val = Number(updates[field]);
        if (isNaN(val) || val < 0 || val > 100) {
          return res.status(400).json({
            success: false,
            message: `Validation failed: ${field} must be a number between 0 and 100`
          });
        }
      }
    }

    // 2. Validate positive/zero decimal fields
    for (const field of positiveOrZeroDecimalFields) {
      if (updates[field] !== undefined) {
        const val = Number(updates[field]);
        if (isNaN(val) || val < 0) {
          return res.status(400).json({
            success: false,
            message: `Validation failed: ${field} must be a non-negative number`
          });
        }
      }
    }

    // 3. Validate tscInitialPriceUSDT (must be positive > 0)
    if (updates.tscInitialPriceUSDT !== undefined) {
      const val = Number(updates.tscInitialPriceUSDT);
      if (isNaN(val) || val <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: tscInitialPriceUSDT must be a positive number'
        });
      }
    }

    // 4. Validate tscReleaseMonths (must be positive integer > 0)
    if (updates.tscReleaseMonths !== undefined) {
      const val = Number(updates.tscReleaseMonths);
      if (isNaN(val) || val <= 0 || !Number.isInteger(val)) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: tscReleaseMonths must be a positive integer'
        });
      }
    }

    // 5. Validate tscVestingDays (must be non-negative integer >= 0)
    if (updates.tscVestingDays !== undefined) {
      const val = Number(updates.tscVestingDays);
      if (isNaN(val) || val < 0 || !Number.isInteger(val)) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: tscVestingDays must be a non-negative integer'
        });
      }
    }

    // 6. Validate withdrawal split sum (tscWithdrawalInstantPercent + tscWithdrawalVestingPercent = 100)
    const instant = updates.tscWithdrawalInstantPercent !== undefined 
      ? Number(updates.tscWithdrawalInstantPercent) 
      : toNum(config.tscWithdrawalInstantPercent);
    const vesting = updates.tscWithdrawalVestingPercent !== undefined 
      ? Number(updates.tscWithdrawalVestingPercent) 
      : toNum(config.tscWithdrawalVestingPercent);
    if (instant + vesting !== 100) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed: The sum of tscWithdrawalInstantPercent and tscWithdrawalVestingPercent must equal 100'
      });
    }

    // Apply updates
    // Decimal fields
    const decimalFields = [
      'tscInitialPriceUSDT',
      'tscDailyIncreasePercent',
      'tscDailyIncreaseMinPercent',
      'tscDailyIncreaseMaxPercent',
      'monthlyEmissionPercent',
      'tscWithdrawalFeePercent',
      'tscWithdrawalInstantPercent',
      'tscWithdrawalVestingPercent',
      'tscToTkcSwapFeePercent',
      'referralLevel1Percent',
      'referralLevel2Percent',
      'assistanceRewardPercent'
    ];

    decimalFields.forEach(field => {
      if (updates[field] !== undefined) {
        config[field] = toDecimal128(updates[field]);
      }
    });

    // Non-decimal fields
    if (updates.tscReleaseMonths !== undefined) config.tscReleaseMonths = updates.tscReleaseMonths;
    if (updates.tscVestingDays !== undefined) config.tscVestingDays = updates.tscVestingDays;
    
    // Launch Date logic
    if (updates.isTscLaunched !== undefined) {
      const isLaunched = Boolean(updates.isTscLaunched);
      if (isLaunched && !config.isTscLaunched) {
        config.isTscLaunched = true;
        config.tscLaunchDate = new Date();
      } else if (!isLaunched) {
        config.isTscLaunched = false;
        config.tscLaunchDate = undefined;
      }
    }

    // Log who updated it
    config.updatedBy = req.user ? req.user._id : null;

    await config.save();

    res.status(200).json({
      success: true,
      message: 'Protocol configuration updated successfully',
      data: formatDecimals(config)
    });
  } catch (error) {
    console.error('Error updating protocol config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update protocol config',
      error: error.message
    });
  }
};

// GET /api/admin/protocol/nft-tiers
exports.getNftTiers = async (req, res) => {
  try {
    const tiers = await NftTier.find().sort({ sortOrder: 1 });
    res.status(200).json({
      success: true,
      data: formatDecimals(tiers)
    });
  } catch (error) {
    console.error('Error fetching NFT tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch NFT tiers',
      error: error.message
    });
  }
};

// PUT /api/admin/protocol/nft-tiers/:code
exports.updateNftTier = async (req, res) => {
  try {
    const { code } = req.params;
    const updates = req.body;

    const tier = await NftTier.findOne({ code });
    if (!tier) {
      return res.status(404).json({
        success: false,
        message: `NFT tier with code ${code} not found`
      });
    }

    // Validations
    // Positive numeric fields
    const positiveDecimalFields = [
      'mintPriceU',
      'miningPower',
      'powerCoefficient',
      'poolMultiplierBeforeTsc',
      'poolMultiplierAfterTsc'
    ];

    for (const field of positiveDecimalFields) {
      if (updates[field] !== undefined) {
        const val = Number(updates[field]);
        if (isNaN(val) || val <= 0) {
          return res.status(400).json({
            success: false,
            message: `Validation failed: ${field} must be a positive number`
          });
        }
      }
    }

    // Daily Yield validation (0 to 100)
    if (updates.dailyYieldRatePercent !== undefined) {
      const val = Number(updates.dailyYieldRatePercent);
      if (isNaN(val) || val < 0 || val > 100) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: dailyYieldRatePercent must be between 0 and 100'
        });
      }
    }

    // Sort order validation (non-negative integer)
    if (updates.sortOrder !== undefined) {
      const val = Number(updates.sortOrder);
      if (isNaN(val) || val < 0 || !Number.isInteger(val)) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: sortOrder must be a non-negative integer'
        });
      }
    }

    // Apply updates
    if (updates.name !== undefined) tier.name = updates.name;
    if (updates.tscAllocationMode !== undefined) tier.tscAllocationMode = updates.tscAllocationMode;
    if (updates.isActive !== undefined) tier.isActive = Boolean(updates.isActive);
    if (updates.sortOrder !== undefined) tier.sortOrder = updates.sortOrder;

    // Decimal fields
    const decimalFields = [
      'mintPriceU',
      'miningPower',
      'powerCoefficient',
      'poolMultiplierBeforeTsc',
      'poolMultiplierAfterTsc',
      'dailyYieldRatePercent'
    ];

    decimalFields.forEach(field => {
      if (updates[field] !== undefined) {
        tier[field] = toDecimal128(updates[field]);
      }
    });

    await tier.save();

    res.status(200).json({
      success: true,
      message: `NFT Tier ${code} updated successfully`,
      data: formatDecimals(tier)
    });
  } catch (error) {
    console.error(`Error updating NFT tier ${req.params.code}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to update NFT tier',
      error: error.message
    });
  }
};

// GET /api/admin/protocol/node-levels
exports.getNodeLevels = async (req, res) => {
  try {
    const levels = await NodeLevelConfig.find().sort({ sortOrder: 1 });
    res.status(200).json({
      success: true,
      data: formatDecimals(levels)
    });
  } catch (error) {
    console.error('Error fetching node levels:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch node levels',
      error: error.message
    });
  }
};

// PUT /api/admin/protocol/node-levels/:code
exports.updateNodeLevel = async (req, res) => {
  try {
    const { code } = req.params;
    const updates = req.body;

    const level = await NodeLevelConfig.findOne({ code });
    if (!level) {
      return res.status(404).json({
        success: false,
        message: `Node level config with code ${code} not found`
      });
    }

    // Validations
    // Non-negative decimal fields
    const nonNegativeDecimalFields = [
      'upgradeMiningPower',
      'totalMiningPower'
    ];

    for (const field of nonNegativeDecimalFields) {
      if (updates[field] !== undefined) {
        const val = Number(updates[field]);
        if (isNaN(val) || val < 0) {
          return res.status(400).json({
            success: false,
            message: `Validation failed: ${field} must be a non-negative number`
          });
        }
      }
    }

    // Percentages validation (0 to 100)
    const percentageFields = [
      'miningOutputPercent',
      'airdropAllocationPercent'
    ];

    for (const field of percentageFields) {
      if (updates[field] !== undefined) {
        const val = Number(updates[field]);
        if (isNaN(val) || val < 0 || val > 100) {
          return res.status(400).json({
            success: false,
            message: `Validation failed: ${field} must be between 0 and 100`
          });
        }
      }
    }

    // Sort order validation (non-negative integer)
    if (updates.sortOrder !== undefined) {
      const val = Number(updates.sortOrder);
      if (isNaN(val) || val < 0 || !Number.isInteger(val)) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed: sortOrder must be a non-negative integer'
        });
      }
    }

    // Apply updates
    if (updates.isActive !== undefined) level.isActive = Boolean(updates.isActive);
    if (updates.sortOrder !== undefined) level.sortOrder = updates.sortOrder;

    // Decimal fields
    const decimalFields = [
      'upgradeMiningPower',
      'totalMiningPower',
      'miningOutputPercent',
      'airdropAllocationPercent'
    ];

    decimalFields.forEach(field => {
      if (updates[field] !== undefined) {
        level[field] = toDecimal128(updates[field]);
      }
    });

    await level.save();

    res.status(200).json({
      success: true,
      message: `Node Level Config ${code} updated successfully`,
      data: formatDecimals(level)
    });
  } catch (error) {
    console.error(`Error updating node level ${req.params.code}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to update node level config',
      error: error.message
    });
  }
};
