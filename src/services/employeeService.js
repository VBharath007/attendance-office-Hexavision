const { db } = require('../config/firebase');

const getAllEmployees = async () => {
  const snap = await db.collection('employees').orderBy('full_name').get();
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

module.exports = { getAllEmployees, updateSalary };
