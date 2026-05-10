const jwt = require('jsonwebtoken');
const { db } = require('../config/firebase');

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

const generateAccessToken = (user) => {
  return jwt.sign(
    { uid: user.uid, role: user.role, employee_id: user.employee_id },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

const generateRefreshToken = async (user) => {
  const refreshToken = jwt.sign(
    { uid: user.uid },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  // Store hashed refresh token in Firestore for session management
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await db.collection('sessions').doc(refreshToken.substring(0, 20)).set({
    uid: user.uid,
    token_preview: refreshToken.substring(0, 10) + '...',
    expires_at: expiresAt,
    created_at: new Date()
  });

  return refreshToken;
};

const verifyToken = (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
};

const revokeToken = async (refreshToken) => {
  try {
    await db.collection('sessions').doc(refreshToken.substring(0, 20)).delete();
    return true;
  } catch (err) {
    return false;
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  revokeToken
};
