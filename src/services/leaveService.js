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
  const snap = await db.collection('leaves').where('employee_id', '==', userId).orderBy('created_at', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

module.exports = { applyLeave, getEmployeeLeaves };
