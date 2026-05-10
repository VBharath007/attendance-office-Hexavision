const jwt = require('jsonwebtoken');

// Use environment variables or fallback to a default for development
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'hexa_access_secret_2024';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'hexa_refresh_secret_2024';

const ACCESS_EXPIRY = '1h';
const REFRESH_EXPIRY = '7d';

/**
 * Generate an Access Token
 * @param {Object} payload { uid, role, employee_id }
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY });
};

/**
 * Generate a Refresh Token
 * @param {Object} payload { uid, role }
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
};

/**
 * Verify an Access Token
 * @param {string} token 
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (err) {
    return null;
  }
};

/**
 * Verify a Refresh Token
 * @param {string} token 
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (err) {
    return null;
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
