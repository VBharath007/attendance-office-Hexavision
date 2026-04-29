const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Routes
router.post('/employee/register', authController.register);
router.post('/employee/login', authController.login);

module.exports = router;
