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

const getMonthly = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const result = await attendanceService.getMonthlyAttendance(req.user.uid, month, year);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    
    // Get both history and summary
    const history = await attendanceService.getMonthlyAttendance(req.user.uid, month, year);
    const summary = await attendanceService.computeMonthlySummary(req.user.uid, month, year);
    
    res.json({ 
      success: true, 
      data: {
        records: history.records,
        summary: summary || {
          employee_id: req.user.uid,
          month, year,
          total_working_days: 0,
          present_days: 0,
          absent_days: 0,
          remaining_days: 0,
          late_days: 0,
          net_salary: 0,
          gross_salary: 0,
          total_deduction: 0,
          total_expected_hours: 180
        }
      }
    });
  } catch (err) {
    console.error('❌ Error in getMonthlySummary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};


const getAdminToday = async (req, res) => {
  try {
    const result = await attendanceService.getAdminToday();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAdminEmployeeMonthly = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    
    const history = await attendanceService.getMonthlyAttendance(employeeId, month, year);
    const summary = await attendanceService.computeMonthlySummary(employeeId, month, year);
    
    res.json({ 
      success: true, 
      data: {
        records: history.records,
        summary: summary
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const editTiming = async (req, res) => {
  try {
    const { employeeId, date, checkInTime, checkOutTime } = req.body;
    if (!employeeId || !date || !checkInTime) {
      return res.status(400).json({ success: false, message: 'employeeId, date, and checkInTime are required.' });
    }
    const result = await attendanceService.editAttendanceTiming(employeeId, date, checkInTime, checkOutTime);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { checkIn, checkOut, getToday, getAdminToday, getMonthly, getMonthlySummary, getAdminEmployeeMonthly, editTiming };
