const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');

const registerEmployee = async (data) => {
  console.log('🚀 Registration started for:', data.employee_id);
  const { employee_id, full_name, email, phone, password, department_id, designation, join_date } = data;

  try {
    console.log('🔍 Checking if employee exists in collection "employees"...');
    const existing = await db.collection('employees').where('employee_id', '==', employee_id).limit(1).get();
    if (!existing.empty) throw new Error('Employee ID already registered');
  } catch (err) {
    console.error('❌ Firestore Error during check:', err);
    throw err;
  }


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
  return { custom_token: customToken, employee: emp };
};

const adminLogin = async (username, password) => {
  let adminSnap = await db.collection('admins').where('username', '==', username).limit(1).get();
  
  // 🚀 AUTO-CREATE: If no admins exist at all, create a default one
  const allAdmins = await db.collection('admins').limit(1).get();
  if (allAdmins.empty && username === 'admin') {
    console.log('👑 No admins found. Creating default admin...');
    const hashed = await bcrypt.hash('admin123', 12);
    const newAdmin = { username: 'admin', password: hashed, full_name: 'Super Admin', role: 'admin' };
    const docRef = await db.collection('admins').add(newAdmin);
    const customToken = await auth.createCustomToken(docRef.id, { role: 'admin' });
    return { custom_token: customToken, admin: { ...newAdmin, password: null } };
  }

  if (adminSnap.empty) throw new Error('Invalid admin credentials');
  const adminData = adminSnap.docs[0].data();

  const isMatch = await bcrypt.compare(password, adminData.password);
  if (!isMatch) throw new Error('Invalid admin credentials');

  const customToken = await auth.createCustomToken(adminSnap.docs[0].id, { role: 'admin' });
  const { password: _, ...adminProfile } = adminData;
  return { custom_token: customToken, admin: { ...adminProfile, role: 'admin' } };
};



const getUserProfile = async (uid, role) => {
  if (role === 'admin') {
    const doc = await db.collection('admins').doc(uid).get();
    return doc.exists ? { ...doc.data(), role: 'admin' } : null;
  } else {
    const doc = await db.collection('employees').doc(uid).get();
    return doc.exists ? { ...doc.data(), role: 'employee' } : null;
  }
};

module.exports = { registerEmployee, loginEmployee, adminLogin, getUserProfile };


