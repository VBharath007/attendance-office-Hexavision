const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');
const employeeController = require('../controllers/employeeController');

// Routes
router.get('/', authenticate, adminOnly, employeeController.list);
router.patch('/:uid/approve', authenticate, adminOnly, employeeController.approve);
router.patch('/:uid/salary', authenticate, adminOnly, employeeController.setSalary);
router.delete('/:uid', authenticate, adminOnly, employeeController.deleteEmployee);

module.exports = router;
