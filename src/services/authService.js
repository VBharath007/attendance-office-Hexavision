const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const tokenService = require('./tokenService');

const registerEmployee = async (data) => {
  console.log('🚀 Registration started for:', data.employee_id);
  const { employee_id, full_name, email, phone, password, department_id, designation, join_date } = data;

  try {
    const existing = await db.collection('employees').where('employee_id', '==', employee_id).limit(1).get();
    if (!existing.empty) throw new Error('Employee ID already registered');
    
    const existingEmail = await db.collection('employees').where('email', '==', email).limit(1).get();
    if (!existingEmail.empty) throw new Error('Email already registered');
  } catch (err) {
    throw err;
  }

  // Firebase Auth (Keep it for push notifications and sync if needed)
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

  const user = { uid: emp.uid, role: 'employee', employee_id: emp.employee_id };
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = await tokenService.generateRefreshToken(user);
  const customToken = await auth.createCustomToken(emp.uid, { role: 'employee' });

  return { 
    access_token: accessToken, 
    refresh_token: refreshToken,
    custom_token: customToken,
    employee: { ...emp, password: null } 
  };
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
    adminSnap = await docRef.get();
  }

  if (adminSnap.empty || (adminSnap.docs && adminSnap.docs.length === 0)) throw new Error('Invalid admin credentials');
  
  const adminDoc = adminSnap.docs ? adminSnap.docs[0] : adminSnap;
  const adminData = adminDoc.data();

  const isMatch = await bcrypt.compare(password, adminData.password);
  if (!isMatch) throw new Error('Invalid admin credentials');

  const user = { uid: adminDoc.id, role: 'admin', username: adminData.username };
  const accessToken = tokenService.generateAccessToken(user);
  const refreshToken = await tokenService.generateRefreshToken(user);
  const customToken = await auth.createCustomToken(adminDoc.id, { role: 'admin' });

  const { password: _, ...adminProfile } = adminData;
  return { 
    access_token: accessToken, 
    refresh_token: refreshToken,
    custom_token: customToken,
    admin: { ...adminProfile, role: 'admin' } 
  };
};

const refreshAuthToken = async (refreshToken) => {
  const decoded = tokenService.verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
  if (!decoded) throw new Error('Invalid refresh token');

  // Check if session exists in DB
  const sessionDoc = await db.collection('sessions').doc(refreshToken.substring(0, 20)).get();
  if (!sessionDoc.exists) throw new Error('Session expired or revoked');

  const userProfile = await getUserProfile(decoded.uid, 'employee'); // Default to employee, or check claims
  if (!userProfile) throw new Error('User not found');

  const accessToken = tokenService.generateAccessToken({ 
    uid: userProfile.uid, 
    role: userProfile.role,
    employee_id: userProfile.employee_id 
  });

  return { access_token: accessToken };
};

const logoutUser = async (refreshToken) => {
  return await tokenService.revokeToken(refreshToken);
};

const getUserProfile = async (uid, role) => {
  // Try employee first
  let doc = await db.collection('employees').doc(uid).get();
  if (doc.exists) return { ...doc.data(), role: 'employee' };
  
  // Try admin
  doc = await db.collection('admins').doc(uid).get();
  if (doc.exists) return { ...doc.data(), role: 'admin' };
  
  return null;
};

module.exports = { 
  registerEmployee, 
  loginEmployee, 
  adminLogin, 
  getUserProfile, 
  refreshAuthToken,
  logoutUser
};


