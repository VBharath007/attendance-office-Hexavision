const { db, auth } = require('../config/firebase');

/**
 * Service to handle data isolation and secure cleanup
 */

/**
 * Delete all data associated with a specific employee UID
 * @param {string} uid Employee UID
 */
const deleteEmployeeData = async (uid) => {
  if (!uid) throw new Error('UID is required for deletion');

  const batch = db.batch();

  // 1. Delete Attendance records
  const attendanceSnap = await db.collection('attendance')
    .where('employee_id', '==', uid).get();
  attendanceSnap.forEach(doc => batch.delete(doc.ref));

  // 2. Delete Leave records
  const leavesSnap = await db.collection('leaves')
    .where('employee_id', '==', uid).get();
  leavesSnap.forEach(doc => batch.delete(doc.ref));

  // 3. Delete Warnings
  const warningsSnap = await db.collection('warnings')
    .where('employee_id', '==', uid).get();
  warningsSnap.forEach(doc => batch.delete(doc.ref));

  // 4. Delete Monthly Summaries
  const summariesSnap = await db.collection('monthly_summary')
    .where('employee_id', '==', uid).get();
  summariesSnap.forEach(doc => batch.delete(doc.ref));

  // 5. Delete Sessions
  const sessionsSnap = await db.collection('sessions')
    .where('uid', '==', uid).get();
  sessionsSnap.forEach(doc => batch.delete(doc.ref));

  // 6. Delete Employee Document
  batch.delete(db.collection('employees').doc(uid));

  // Commit Firestore changes
  await batch.commit();

  // 7. Delete from Firebase Auth
  try {
    await auth.deleteUser(uid);
  } catch (err) {
    console.error(`Auth deletion failed for ${uid}:`, err.message);
    // Continue even if auth deletion fails (might be already deleted)
  }

  return { success: true, message: `All data for employee ${uid} has been deleted.` };
};

module.exports = {
  deleteEmployeeData
};
