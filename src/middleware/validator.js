const { body, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

const registerValidation = [
  body('employee_id').notEmpty().withMessage('Employee ID is required'),
  body('full_name').notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  validateRequest
];

const loginValidation = [
  body('identifier').notEmpty().withMessage('Identifier is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validateRequest
];

module.exports = {
  registerValidation,
  loginValidation
};
