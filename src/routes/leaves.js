const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');
const leaveController = require('../controllers/leaveController');

router.post('/apply', authenticate, leaveController.applyLeave);
router.get('/my', authenticate, leaveController.getMyLeaves);
router.get('/admin/pending', authenticate, adminOnly, leaveController.getPendingLeaves);
router.get('/admin/history', authenticate, adminOnly, leaveController.getAllLeaveHistory);
router.patch('/admin/:id/review', authenticate, adminOnly, leaveController.reviewLeave);

module.exports = router;

