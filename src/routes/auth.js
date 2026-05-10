const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate, registerRules, employeeLoginRules, adminLoginRules } = require('../middleware/validator');

// Routes
router.post('/employee/register', registerRules, validate, authController.register);
router.post('/employee/login', employeeLoginRules, validate, authController.login);
router.post('/admin/login', adminLoginRules, validate, authController.adminLogin);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);

module.exports = router;

