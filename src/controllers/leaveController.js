const leaveService = require('../services/leaveService');

const applyLeave = async (req, res) => {
  try {
    const result = await leaveService.applyLeave(req.user.uid, req.body);
    res.status(201).json({ success: true, message: 'Leave application submitted', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getMyLeaves = async (req, res) => {
  try {
    const leaves = await leaveService.getEmployeeLeaves(req.user.uid);
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPendingLeaves = async (req, res) => {
  try {
    const leaves = await leaveService.getPendingLeaves();
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const reviewLeave = async (req, res) => {
  try {
    const result = await leaveService.reviewLeave(req.params.id, req.body);
    res.json({ success: true, message: `Leave ${req.body.status}`, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getAllLeaveHistory = async (req, res) => {
  try {
    const leaves = await leaveService.getAdminLeaveHistory();
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { applyLeave, getMyLeaves, getPendingLeaves, reviewLeave, getAllLeaveHistory };

