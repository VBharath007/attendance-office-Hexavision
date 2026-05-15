const { db, messaging } = require('../config/firebase');
const moment = require('moment-timezone');
const C = require('../config/constants');

const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const formatTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
};

const applyLeave = async (userId, data) => {
  const { leave_type, reason, from_date, to_date, permission_date, permission_from, permission_to, permission_type } = data;

  let totalDays = 0;
  let permissionHours = 0;

  const timeBased = ['permission_hours', 'client_meeting', 'employee_support', 'half_day'].contains(leave_type);

  if (timeBased && permission_from && permission_to) {
    const [fH, fM] = permission_from.split(':').map(Number);
    const [tH, tM] = permission_to.split(':').map(Number);
    permissionHours = ((tH * 60 + tM) - (fH * 60 + fM)) / 60;
  }
  
  if (leave_type !== 'permission_hours' && !timeBased) {
    totalDays = (new Date(to_date || from_date) - new Date(from_date)) / 86400000 + 1;
  } else if (leave_type === 'half_day') {
    totalDays = 0.5;
  }

  const leaveRef = await db.collection('leaves').add({
    employee_id: userId, leave_type, reason,
    from_date: from_date || null, to_date: to_date || from_date || null,
    total_days: totalDays, permission_date: permission_date || null,
    permission_from: permission_from || null, permission_to: permission_to || null,
    permission_hours: permissionHours, status: 'pending', created_at: new Date()
  });

  return { id: leaveRef.id };
};

const getEmployeeLeaves = async (userId) => {
  const snap = await db.collection('leaves').where('employee_id', '==', userId).get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.created_at?.toDate() || 0) - (a.created_at?.toDate() || 0));
};

const getPendingLeaves = async () => {
  const snap = await db.collection('leaves').where('status', '==', 'pending').get();
  const leaves = [];
  for (const doc of snap.docs) {
    const leave = { id: doc.id, ...doc.data() };
    const empSnap = await db.collection('employees').doc(leave.employee_id).get();
    leave.employee = empSnap.exists ? empSnap.data() : null;
    leaves.push(leave);
  }
  return leaves;
};

const reviewLeave = async (id, { status, admin_remarks }) => {
  const leaveDoc = await db.collection('leaves').doc(id).get();
  if (!leaveDoc.exists) throw new Error('Leave request not found');
  const leaveData = leaveDoc.data();

  await db.collection('leaves').doc(id).update({
    status, admin_remarks: admin_remarks || '', reviewed_at: new Date()
  });

  // Automatically create attendance record if Employee Support is approved
  if (status === 'approved' && leaveData.leave_type === 'employee_support') {
    const { employee_id, permission_date, permission_from, permission_to } = leaveData;
    
    const inMin = toMin(permission_from);
    const outMin = toMin(permission_to);
    const rawHours = (outMin - inMin) / 60;
    // Deduct lunch break if worked > 6 hours (matches attendanceService.js)
    const lunchDeduction = rawHours > 6 ? (C.LUNCH_BREAK_HOURS || 1) : 0;
    const workingHours = parseFloat(Math.max(0, rawHours - lunchDeduction).toFixed(2));
    
    const appreciationInMax = toMin(C.APPRECIATION_CHECKIN_MAX || '10:10');
    const appreciationOutMin = toMin(C.APPRECIATION_CHECKOUT_MIN || '19:30');
    const isAppreciated = (inMin <= appreciationInMax) && (outMin >= appreciationOutMin);
    
    const officeStart = toMin(C.OFFICE_START || '09:30');
    const graceLimit = toMin(C.GRACE_TIME || '10:10');
    const officeEnd = toMin(C.OFFICE_END || '18:30');

    let attStatus = 'present';
    if (workingHours < 4) attStatus = 'absent';
    else if (inMin > graceLimit) attStatus = 'late';

    await db.collection('attendance').doc(`${employee_id}_${permission_date}`).set({
      employee_id,
      date: permission_date,
      check_in: formatTime(permission_from),
      check_out: formatTime(permission_to),
      status: attStatus,
      working_hours: workingHours,
      late_minutes: inMin > officeStart ? Math.max(0, inMin - officeStart) : 0,
      overtime_minutes: Math.max(0, outMin - officeEnd),
      is_appreciated: isAppreciated,
      is_warning_day: false,
      late_deduction_hours: 0,
      updated_at: new Date()
    }, { merge: true });
  }

  return { id, status };
};

const getAdminLeaveHistory = async () => {
  const leavesSnap = await db.collection('leaves').orderBy('created_at', 'desc').get();
  const empSnap = await db.collection('employees').get();
  const employees = {};
  empSnap.docs.forEach(doc => { employees[doc.id] = doc.data(); });

  const data = leavesSnap.docs.map(doc => {
    const leave = doc.data();
    const emp = employees[leave.employee_id] || {};
    return {
      id: doc.id,
      ...leave,
      full_name: emp.full_name || 'Unknown',
      designation: emp.designation || 'Staff',
      employee_id_display: emp.employee_id || leave.employee_id,
    };
  });

  return data;
};

module.exports = { applyLeave, getEmployeeLeaves, getPendingLeaves, reviewLeave, getAdminLeaveHistory };

