const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { db } = require('../config/firebase');

router.get('/', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('notifications')
      .where('recipient_type', '==', req.user.role)
      .where('recipient_id', '==', req.user.uid)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get();
    const notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unread_count = notifications.filter(n => !n.is_read).length;
    res.json({ success: true, data: notifications, unread_count });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('notifications')
      .where('recipient_id', '==', req.user.uid)
      .where('is_read', '==', false).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.update(d.ref, { is_read: true }));
    await batch.commit();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/token', authenticate, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token is required' });
  
  try {
    const userType = req.user.role === 'admin' ? 'admins' : 'employees';
    await db.collection(userType).doc(req.user.uid).update({
      fcm_token: token,
      updated_at: new Date()
    });
    
    // Also update active session if it exists
    const sessionSnap = await db.collection('sessions')
      .where('uid', '==', req.user.uid)
      .where('is_active', '==', true)
      .get();
      
    if (!sessionSnap.empty) {
      const batch = db.batch();
      sessionSnap.docs.forEach(doc => batch.update(doc.ref, { fcm_token: token }));
      await batch.commit();
    }
    
    res.json({ success: true, message: 'Token updated successfully' });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
});

module.exports = router;

