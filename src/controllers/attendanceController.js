const attendanceService = require('../services/attendanceService');

const checkIn = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const result = await attendanceService.checkIn(req.user.uid, latitude, longitude);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const checkOut = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const result = await attendanceService.checkOut(req.user.uid, latitude, longitude);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const getToday = async (req, res) => {
  try {
    const today = await attendanceService.getTodayRecord(req.user.uid);
    res.json({ success: true, data: today });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { checkIn, checkOut, getToday };
