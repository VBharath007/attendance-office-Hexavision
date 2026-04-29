const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');

const registerEmployee = async (data) => {
  const { employee_id, full_name, email, phone, password, department_id, designation, join_date } = data;

  // Check duplicate
  const existing = await db.collection('employees').where('employee_id', '==', employee_id).limit(1).get();
  if (!existing.empty) throw new Error('Employee ID already registered');

  // Firebase Auth
  const userRecord = await auth.createUser({ email, password, displayName: full_name });
  await auth.setCustomUserClaims(userRecord.uid, { role: 'employee' });

  const hashedPassword = await bcrypt.hash(password, 12);

  // Firestore Save
  const userData = {
    uid: userRecord.uid, employee_id, full_name, email, phone,
    password: hashedPassword, department_id: department_id || null,
    designation: designation || null, join_date: join_date || null,
    status: 'pending', monthly_salary: 0, earned_leave_balance: 0,
    late_warning_count: 0, created_at: new Date(), updated_at: new Date()
  };

  await db.collection('employees').doc(userRecord.uid).set(userData);
  return { uid: userRecord.uid, status: 'pending' };
};

const loginEmployee = async (identifier, password) => {
  let empSnap;
  if (identifier.includes('@')) {
    empSnap = await db.collection('employees').where('email', '==', identifier).limit(1).get();
  } else {
    empSnap = await db.collection('employees').where('employee_id', '==', identifier).limit(1).get();
  }

  if (empSnap.empty) throw new Error('Invalid credentials');
  const emp = empSnap.docs[0].data();

  const isMatch = await bcrypt.compare(password, emp.password);
  if (!isMatch) throw new Error('Invalid credentials');

  if (emp.status !== 'active') throw new Error(`Account ${emp.status}`);

  const customToken = await auth.createCustomToken(empSnap.docs[0].id, { role: 'employee' });
  return { customToken, employee: emp };
};

module.exports = { registerEmployee, loginEmployee };
