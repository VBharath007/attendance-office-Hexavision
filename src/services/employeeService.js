const { db } = require('../config/firebase');
const cryptoUtils = require('./cryptoUtils');

const getAllEmployees = async (status = null) => {
  let query = db.collection('employees');
  if (status) {
    query = query.where('status', '==', status);
  }
  const snap = await query.get();
  return snap.docs.map(d => {
    const data = d.data();
    return { 
      uid: d.id, 
      ...data,
      account_number: cryptoUtils.decrypt(data.account_number),
      ifsc_code: cryptoUtils.decrypt(data.ifsc_code)
    };
  });
};



const updateSalary = async (uid, salaryData) => {
  const { monthly_salary, bank_name, account_number, ifsc_code } = salaryData;
  await db.collection('employees').doc(uid).update({
    monthly_salary: parseFloat(monthly_salary),
    bank_name: bank_name || '',
    account_number: cryptoUtils.encrypt(account_number) || '',
    ifsc_code: cryptoUtils.encrypt(ifsc_code) || '',
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

const deleteEmployee = async (uid) => {
  const batch = db.batch();
  
  // 1. Delete Employee Doc
  batch.delete(db.collection('employees').doc(uid));

  // 2. Delete Attendance Records
  const attSnap = await db.collection('attendance').where('employee_id', '==', uid).get();
  attSnap.forEach(doc => batch.delete(doc.ref));

  // 3. Delete Leave Records
  const leaveSnap = await db.collection('leaves').where('employee_id', '==', uid).get();
  leaveSnap.forEach(doc => batch.delete(doc.ref));

  // 4. Delete Monthly Summaries
  const summarySnap = await db.collection('monthly_summary').where('employee_id', '==', uid).get();
  summarySnap.forEach(doc => batch.delete(doc.ref));

  // 5. Delete Sessions
  const sessionSnap = await db.collection('sessions').where('uid', '==', uid).get();
  sessionSnap.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
  return { uid, deleted: true };
};

module.exports = { getAllEmployees, updateSalary, approveEmployee, deleteEmployee };

