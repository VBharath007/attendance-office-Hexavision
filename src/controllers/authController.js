const authService = require('../services/authService');

const register = async (req, res) => {
  try {
    const result = await authService.registerEmployee(req.body);
    res.status(201).json({ success: true, message: 'Registration successful! Waiting for approval.', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const result = await authService.loginEmployee(identifier, password);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
};

module.exports = { register, login };
