const { validationResult, body } = require('express-validator');

/**
 * Middleware to handle validation results
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  const extractedErrors = [];
  errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

  return res.status(422).json({
    success: false,
    message: 'Validation failed',
    errors: extractedErrors,
  });
};

// Common validation rules
const employeeLoginRules = [
  body('identifier').notEmpty().withMessage('Identifier (Email or Employee ID) is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const adminLoginRules = [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const registerRules = [
  body('employee_id').notEmpty().withMessage('Employee ID is required'),
  body('full_name').notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

module.exports = {
  validate,
  employeeLoginRules,
  adminLoginRules,
  registerRules
};
