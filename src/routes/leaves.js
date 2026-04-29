const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const leaveController = require('../controllers/leaveController');

// Routes
router.post('/apply', authenticate, leaveController.applyLeave);
router.get('/my', authenticate, leaveController.getMyLeaves);

module.exports = router;
