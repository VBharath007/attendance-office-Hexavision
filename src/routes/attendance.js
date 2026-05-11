const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');

const attendanceController = require('../controllers/attendanceController');

// Routes
router.post('/check-in', authenticate, attendanceController.checkIn);
router.post('/check-out', authenticate, attendanceController.checkOut);
router.get('/today', authenticate, attendanceController.getToday);
router.get('/monthly', authenticate, attendanceController.getMonthlySummary);
router.get('/history', authenticate, attendanceController.getMonthly);
router.get('/appreciations', authenticate, attendanceController.getMonthlySummary); // Reuse summary for now
router.get('/admin/today', authenticate, adminOnly, attendanceController.getAdminToday);
router.get('/admin/employee/:employeeId/monthly', authenticate, adminOnly, attendanceController.getAdminEmployeeMonthly);
router.post('/admin/edit-timing', authenticate, adminOnly, attendanceController.editTiming);


module.exports = router;

