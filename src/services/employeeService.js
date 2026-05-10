const { db } = require('../config/firebase');

const getAllEmployees = async (status = null) => {
  let query = db.collection('employees');
  if (status) {
    query = query.where('status', '==', status);
  }
  const snap = await query.get();
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
};



const updateSalary = async (uid, salaryData) => {
  const { monthly_salary, bank_name, account_number, ifsc_code } = salaryData;
  await db.collection('employees').doc(uid).update({
    monthly_salary: parseFloat(monthly_salary),
    bank_name: bank_name || '',
    account_number: account_number || '',
    ifsc_code: ifsc_code || '',
    updated_at: new Date()
  });
  return { uid, monthly_salary };
};

const approveEmployee = async (uid) => {
  await db.collection('employees').doc(uid).update({
    status: 'active',
    updated_at: new Date()
  });
  return { uid, status: 'active' };
};

module.exports = { getAllEmployees, updateSalary, approveEmployee };

