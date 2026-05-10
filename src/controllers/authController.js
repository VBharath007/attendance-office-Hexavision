const authService = require('../services/authService');

const register = async (req, res) => {
  try {
    const result = await authService.registerEmployee(req.body);
    res.status(201).json({ 
      success: true, 
      message: 'Registration successful! Waiting for approval.', 
      data: result 
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const result = await authService.loginEmployee(identifier, password);
    res.json({ success: true, message: 'Login successful', data: result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
};

const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await authService.adminLogin(username, password);
    res.json({ success: true, message: 'Admin login successful', data: result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) throw new Error('Refresh token required');
    const result = await authService.refreshAuthToken(refresh_token);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
};

const logout = async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) await authService.logoutUser(refresh_token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const result = await authService.getUserProfile(req.user.uid, req.user.role);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { register, login, adminLogin, getMe, refreshToken, logout };


