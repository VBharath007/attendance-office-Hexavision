const { auth, db } = require('../config/firebase');
const bcrypt = require('bcryptjs');
const tokenService = require('./tokenService');
const { v4: uuidv4 } = require('uuid');

const registerEmployee = async (data) => {
  const { employee_id, full_name, email, phone, password, department_id, designation, join_date } = data;

  const existing = await db.collection('employees').where('employee_id', '==', employee_id).limit(1).get();
  if (!existing.empty) throw new Error('Employee ID already registered');

  // Firebase Auth (Keep for identity, but we use our own tokens for API)
  const userRecord = await auth.createUser({ email, password, displayName: full_name });
  await auth.setCustomUserClaims(userRecord.uid, { role: 'employee' });

  const hashedPassword = await bcrypt.hash(password, 12);

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

const loginEmployee = async (identifier, password, deviceInfo = {}) => {
  let empSnap;
  if (identifier.includes('@')) {
    empSnap = await db.collection('employees').where('email', '==', identifier).limit(1).get();
  } else {
    empSnap = await db.collection('employees').where('employee_id', '==', identifier).limit(1).get();
  }

  if (empSnap.empty) throw new Error('Invalid credentials');
  const empDoc = empSnap.docs[0];
  const emp = empDoc.data();

  const isMatch = await bcrypt.compare(password, emp.password);
  if (!isMatch) throw new Error('Invalid credentials');

  if (emp.status !== 'active') throw new Error(`Account ${emp.status}`);

  // Generate Tokens
  const payload = { uid: empDoc.id, role: 'employee', employee_id: emp.employee_id };
  const accessToken = tokenService.generateAccessToken(payload);
  const refreshToken = tokenService.generateRefreshToken({ uid: empDoc.id, role: 'employee' });

  // Create Session
  const sessionId = uuidv4();
  await db.collection('sessions').doc(sessionId).set({
    uid: empDoc.id,
    refresh_token: refreshToken,
    device_id: deviceInfo.device_id || 'unknown',
    device_name: deviceInfo.device_name || 'unknown',
    fcm_token: deviceInfo.fcm_token || null,
    last_login: new Date(),
    is_active: true
  });

  // Update FCM Token in employee record
  if (deviceInfo.fcm_token) {
    await empDoc.ref.update({ fcm_token: deviceInfo.fcm_token, updated_at: new Date() });
  }

  const customToken = await auth.createCustomToken(empDoc.id, { role: 'employee' });

  const { password: _, ...employeeProfile } = emp;
  return { 
    access_token: accessToken, 
    refresh_token: refreshToken, 
    custom_token: customToken,
    session_id: sessionId,
    employee: employeeProfile 
  };
};

const adminLogin = async (username, password, deviceInfo = {}) => {
  let adminSnap = await db.collection('admins').where('username', '==', username).limit(1).get();
  
  if (adminSnap.empty) throw new Error('Invalid admin credentials');
  const adminDoc = adminSnap.docs[0];
  const adminData = adminDoc.data();

  const isMatch = await bcrypt.compare(password, adminData.password);
  if (!isMatch) throw new Error('Invalid admin credentials');

  const payload = { uid: adminDoc.id, role: 'admin' };
  const accessToken = tokenService.generateAccessToken(payload);
  const refreshToken = tokenService.generateRefreshToken(payload);

  const sessionId = uuidv4();
  await db.collection('sessions').doc(sessionId).set({
    uid: adminDoc.id,
    refresh_token: refreshToken,
    device_id: deviceInfo.device_id || 'admin_web',
    fcm_token: deviceInfo.fcm_token || null,
    last_login: new Date(),
    is_active: true
  });

  const customToken = await auth.createCustomToken(adminDoc.id, { role: 'admin' });

  const { password: _, ...adminProfile } = adminData;
  return { 
    access_token: accessToken, 
    refresh_token: refreshToken, 
    custom_token: customToken,
    session_id: sessionId,
    admin: { ...adminProfile, role: 'admin' } 
  };
};

const refreshToken = async (token) => {
  const decoded = tokenService.verifyRefreshToken(token);
  if (!decoded) throw new Error('Invalid refresh token');

  const sessionSnap = await db.collection('sessions')
    .where('refresh_token', '==', token)
    .where('is_active', '==', true)
    .limit(1).get();

  if (sessionSnap.empty) throw new Error('Session expired or revoked');

  const payload = { uid: decoded.uid, role: decoded.role };
  const newAccessToken = tokenService.generateAccessToken(payload);

  return { access_token: newAccessToken };
};

const logout = async (sessionId) => {
  if (!sessionId) return;
  await db.collection('sessions').doc(sessionId).update({ 
    is_active: false, 
    logout_at: new Date() 
  });
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

module.exports = { 
  registerEmployee, 
  loginEmployee, 
  adminLogin, 
  getUserProfile,
  refreshToken,
  logout
};


