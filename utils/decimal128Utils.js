const mongoose = require('mongoose');
const Decimal128 = mongoose.Types.Decimal128;
/**
 * Utility functions for Decimal128 arithmetic since Mongoose Decimal128 doesn't have built-in arithmetic methods
 */

/**
 * Add two Decimal128 values
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {mongoose.Types.Decimal128}
 */
// function addDecimal128(a, b) {
//   const aValue = parseFloat(a?.toString() || '0');
//   const bValue = parseFloat(b?.toString() || '0');
//   const result = aValue + bValue;
//   return mongoose.Types.Decimal128.fromString(result.toString());
// }
function addDecimal128(a, b, ...rest) {
  let total = 0;

  // first two (old usage)
  total += parseFloat(a?.toString() || "0");
  total += parseFloat(b?.toString() || "0");

  // additional values (new usage)
  for (const v of rest) {
    total += parseFloat(v?.toString() || "0");
  }

  return mongoose.Types.Decimal128.fromString(total.toString());
}

/**
 * Subtract two Decimal128 values (a - b)
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {mongoose.Types.Decimal128}
 */
function subtractDecimal128(a, b) {
  const aValue = parseFloat(a?.toString() || '0');
  const bValue = parseFloat(b?.toString() || '0');
  let result = aValue - bValue;

  // Add a threshold to floor near-zero results to zero
  // This prevents floating point inaccuracies like 1.3877787807814457E-17
  if (Math.abs(result) < 1e-9) {
      result = 0;
  }

  return mongoose.Types.Decimal128.fromString(result.toString());
}

/**
 * Multiply two Decimal128 values
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {mongoose.Types.Decimal128}
 */
function multiplyDecimal128(a, b) {
  const aValue = parseFloat(a?.toString() || '0');
  const bValue = parseFloat(b?.toString() || '0');
  const result = aValue * bValue;
  return mongoose.Types.Decimal128.fromString(result.toString());
}

/**
 * Compare two Decimal128 values
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareDecimal128(a, b) {
  const aValue = parseFloat(a?.toString() || '0');
  const bValue = parseFloat(b?.toString() || '0');
  if (aValue < bValue) return -1;
  if (aValue > bValue) return 1;
  return 0;
}

/**
 * Find minimum of two Decimal128 values
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {mongoose.Types.Decimal128}
 */
function minDecimal128(a, b) {
  return compareDecimal128(a, b) <= 0 ? a : b;
}

/**
 * Find maximum of two Decimal128 values
 * @param {mongoose.Types.Decimal128} a 
 * @param {mongoose.Types.Decimal128} b 
 * @returns {mongoose.Types.Decimal128}
 */
function maxDecimal128(a, b) {
  return compareDecimal128(a, b) >= 0 ? a : b;
}

/**
 * Ensure a value is a proper Decimal128 object
 * @param {any} value 
 * @param {string} defaultValue 
 * @returns {mongoose.Types.Decimal128}
 */
function ensureDecimal128(value, defaultValue = '0.0') {
  if (value instanceof mongoose.Types.Decimal128) {
    return value;
  }
  return mongoose.Types.Decimal128.fromString(value?.toString() || defaultValue);
}

function convertToFloat(value) {
    if (!value) return 0;
    return parseFloat(value.toString());
}

const roundTo6Decimal128 = (decimalVal) => {
  return Decimal128.fromString(
    Number(parseFloat(decimalVal.toString()).toFixed(6)).toString()
  );
};

module.exports = {
  addDecimal128,
  subtractDecimal128,
  multiplyDecimal128,
  compareDecimal128,
  minDecimal128,
  maxDecimal128,
  ensureDecimal128,
  convertToFloat,
  roundTo6Decimal128
};