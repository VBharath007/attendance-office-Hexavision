const { auth, db } = require('../config/firebase');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token' });

    const decoded = await auth.verifyIdToken(token);
    req.user = { uid: decoded.uid, role: decoded.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Admin access required' });
  next();
};

module.exports = { authenticate, adminOnly };
