const crypto = require('crypto');

/**
 * Generates a random n-digit numerical OTP string.
 * @param {number} length The desired length of the OTP (e.g., 6).
 * @returns {string} The generated OTP.
 */
const generateOTP = (length = 6) => {
  if (length <= 0) {
    throw new Error('OTP length must be a positive integer.');
  }
  // Ensure we get a number that can be padded if it's shorter than `length` (e.g. if Math.random() gives 0.0123... for length 6)
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomNumber.toString().padStart(length, '0');
};

module.exports = generateOTP;




