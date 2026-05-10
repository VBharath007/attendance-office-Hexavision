const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');


const { registerValidation, loginValidation } = require('../middleware/validator');

// Routes
router.post('/employee/register', registerValidation, authController.register);
router.post('/employee/login', loginValidation, authController.login);
router.post('/admin/login', loginValidation, authController.adminLogin);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);

module.exports = router;

