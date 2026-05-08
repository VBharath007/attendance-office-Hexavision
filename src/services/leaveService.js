const { db, messaging } = require('../config/firebase');

const applyLeave = async (userId, data) => {
  const { leave_type, reason, from_date, to_date, permission_date, permission_from, permission_to, permission_type } = data;

  let totalDays = 0;
  let permissionHours = 0;

  if (leave_type === 'permission_hours') {
    const [fH, fM] = permission_from.split(':').map(Number);
    const [tH, tM] = permission_to.split(':').map(Number);
    permissionHours = ((tH * 60 + tM) - (fH * 60 + fM)) / 60;
  } else {
    totalDays = leave_type === 'half_day' ? 0.5 : (new Date(to_date || from_date) - new Date(from_date)) / 86400000 + 1;
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
  await db.collection('leaves').doc(id).update({
    status, admin_remarks: admin_remarks || '', reviewed_at: new Date()
  });
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

