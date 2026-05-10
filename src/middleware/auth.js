const { auth } = require('../config/firebase');
const tokenService = require('../services/tokenService');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Authorization token required' });

    // 1. Try Custom JWT
    let decoded = tokenService.verifyToken(token, process.env.JWT_ACCESS_SECRET);
    
    if (!decoded) {
      // 2. Fallback to Firebase ID Token (for backward compatibility with Flutter app)
      try {
        const firebaseUser = await auth.verifyIdToken(token);
        decoded = { uid: firebaseUser.uid, role: firebaseUser.role || 'employee' };
      } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }
    next();
  };
};

module.exports = { authenticate, adminOnly, checkRole };
