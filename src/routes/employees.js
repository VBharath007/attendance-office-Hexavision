const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');
const employeeController = require('../controllers/employeeController');

// Routes
router.get('/', authenticate, adminOnly, employeeController.list);
router.patch('/:uid/salary', authenticate, adminOnly, employeeController.setSalary);

module.exports = router;
