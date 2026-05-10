const employeeService = require('../services/employeeService');

const list = async (req, res) => {
  try {
    const { status } = req.query;
    const emps = await employeeService.getAllEmployees(status);
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

const approve = async (req, res) => {
  try {
    await employeeService.approveEmployee(req.params.uid);
    res.json({ success: true, message: 'Employee approved successfully' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const result = await employeeService.removeEmployee(req.params.uid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { list, setSalary, approve, deleteEmployee };

