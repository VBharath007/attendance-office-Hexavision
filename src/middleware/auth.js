const { db } = require('../config/firebase');
const tokenService = require('../services/tokenService');

/**
 * Middleware to authenticate requests using custom JWT
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authorization token required' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = tokenService.verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // Optional: Check if session is still active in DB
    // To improve performance, this can be done only for sensitive routes
    // For now, we'll trust the JWT and check UID in employee record
    
    req.user = { 
      uid: decoded.uid, 
      role: decoded.role, 
      employee_id: decoded.employee_id 
    };
    
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

/**
 * Middleware to restrict access to admins only
 */
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

module.exports = { authenticate, adminOnly };
