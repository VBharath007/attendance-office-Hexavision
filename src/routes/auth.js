const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');


// Routes
router.post('/employee/register', authController.register);
router.post('/employee/login', authController.login);
router.post('/admin/login', authController.adminLogin);
router.get('/me', authenticate, authController.getMe);

module.exports = router;

