const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const attendanceController = require('../controllers/attendanceController');

// Routes
router.post('/check-in', authenticate, attendanceController.checkIn);
router.post('/check-out', authenticate, attendanceController.checkOut);
router.get('/today', authenticate, attendanceController.getToday);

module.exports = router;
