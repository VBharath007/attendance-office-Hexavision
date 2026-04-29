const employeeService = require('../services/employeeService');

const list = async (req, res) => {
  try {
    const emps = await employeeService.getAllEmployees();
    res.json({ success: true, data: emps });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const setSalary = async (req, res) => {
  try {
    const result = await employeeService.updateSalary(req.params.uid, req.body);
    res.json({ success: true, message: 'Salary updated successfully', data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

module.exports = { list, setSalary };
