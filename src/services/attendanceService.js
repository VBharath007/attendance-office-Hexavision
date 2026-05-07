const { db } = require('../config/firebase');
const moment = require('moment-timezone');
const C = require('../config/constants');

const TZ = C.TIMEZONE;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

const OFFICE_START = toMin(C.OFFICE_START);
const GRACE = toMin(C.GRACE_TIME);
const OFFICE_END = toMin(C.OFFICE_END);
const APPRECIATION_END = toMin(C.APPRECIATION_CHECKOUT_MIN);

// Haversine formula to get distance in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// ─── Check In ────────────────────────────────────────────────────────────────
const checkIn = async (employeeId, latitude, longitude) => {
  if (!latitude || !longitude) {
    throw new Error('Location access is required to mark attendance');
  }

  const distance = getDistance(latitude, longitude, C.OFFICE_LAT, C.OFFICE_LNG);
  if (distance > C.MAX_DISTANCE_METERS) {
    throw new Error(`You must be within ${C.MAX_DISTANCE_METERS} meters of the office. You are ${Math.round(distance)} meters away.`);
  }
  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');
  const timeNow = now.format('HH:mm');
  const docId = `${employeeId}_${today}`;

  if (now.day() === 0) throw new Error('Today is Sunday - no check-in required');

  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  if (attSnap.exists && attSnap.data().check_in) throw new Error('Already checked in today');

  // Get employee warning state
  const empRef = db.collection('employees').doc(employeeId);
  const empSnap = await empRef.get();
  const emp = empSnap.data();

  const currentMonth = now.month() + 1;
  const currentYear = now.year();
  let warningCount = emp.late_warning_count || 0;

  // Reset monthly warning counter
  if (emp.late_warning_reset_month !== currentMonth || emp.late_warning_reset_year !== currentYear) {
    warningCount = 0;
    await empRef.update({ late_warning_count: 0, late_warning_reset_month: currentMonth, late_warning_reset_year: currentYear });
  }

  const checkInMin = toMin(timeNow);
  const isLate = checkInMin > GRACE;
  const lateMinutes = isLate ? checkInMin - OFFICE_START : 0;
  const newWarningCount = isLate ? warningCount + 1 : warningCount;
  const isWarningDay = isLate && newWarningCount <= C.LATE_WARNING_DAYS;
  const lateDeductionHours = isLate && !isWarningDay ? 1 : 0;

  const batch = db.batch();

  if (isLate) {
    await empRef.update({ late_warning_count: newWarningCount });

    const warnMsg = isWarningDay
      ? `Warning ${newWarningCount}/${C.LATE_WARNING_DAYS}: Late by ${lateMinutes} minutes`
      : `Salary deduction: Late by ${lateMinutes} minutes. 1 hour will be deducted.`;

    batch.set(db.collection('warnings').doc(), {
      employee_id: employeeId,
      date: today,
      type: 'late_arrival',
      message: warnMsg,
      late_minutes: lateMinutes,
      is_read: false,
      created_at: new Date(),
    });
  }

  batch.set(attRef, {
    employee_id: employeeId,
    date: today,
    check_in: timeNow,
    check_in_timestamp: new Date(),
    check_in_lat: latitude || null,
    check_in_lng: longitude || null,
    status: isLate ? C.STATUS.LATE : C.STATUS.PRESENT,
    late_minutes: lateMinutes,
    late_deduction_hours: lateDeductionHours,
    is_warning_day: isWarningDay,
    check_out: null,
    working_hours: 0,
    overtime_minutes: 0,
    is_appreciated: false,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await batch.commit();

  return {
    isLate,
    lateMinutes,
    isWarningDay,
    lateDeductionHours,
    warningCount: newWarningCount,
    message: isLate
      ? isWarningDay
        ? `⚠️ Warning ${newWarningCount}: Late by ${lateMinutes} minutes`
        : `🚨 Late! 1 hour salary deduction will apply`
      : '✅ Checked in on time!',
  };
};

// ─── Check Out ───────────────────────────────────────────────────────────────
const checkOut = async (employeeId, latitude, longitude) => {
  if (!latitude || !longitude) {
    throw new Error('Location access is required to mark attendance');
  }

  const distance = getDistance(latitude, longitude, C.OFFICE_LAT, C.OFFICE_LNG);
  if (distance > C.MAX_DISTANCE_METERS) {
    throw new Error(`You must be within ${C.MAX_DISTANCE_METERS} meters of the office. You are ${Math.round(distance)} meters away.`);
  }

  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');
  const timeNow = now.format('HH:mm');
  const docId = `${employeeId}_${today}`;

  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  if (!attSnap.exists || !attSnap.data().check_in) throw new Error('Please check in first');
  if (attSnap.data().check_out) throw new Error('Already checked out today');

  const data = attSnap.data();
  const checkInMin = toMin(data.check_in);
  const checkOutMin = toMin(timeNow);

  const rawMinutes = checkOutMin - checkInMin;
  const workingHours = parseFloat(Math.max(0, rawMinutes / 60 - C.LUNCH_BREAK_HOURS).toFixed(2));
  const overtimeMinutes = Math.max(0, checkOutMin - OFFICE_END);

  // Appreciation: on-time arrival AND checkout >= 19:30
  const isAppreciated = data.late_minutes === 0 && checkOutMin >= APPRECIATION_END;

  let status = data.status;
  if (workingHours < 4) status = C.STATUS.HALF_DAY;

  await attRef.update({
    check_out: timeNow,
    check_out_timestamp: new Date(),
    check_out_lat: latitude || null,
    check_out_lng: longitude || null,
    working_hours: workingHours,
    overtime_minutes: overtimeMinutes,
    is_appreciated: isAppreciated,
    status,
    updated_at: new Date(),
  });

  return {
    checkOutTime: timeNow,
    workingHours,
    overtimeMinutes,
    isAppreciated,
    message: isAppreciated
      ? '🌟 Great work! You earned an Appreciation badge today!'
      : `✅ Checked out. Worked ${workingHours.toFixed(1)} hours today`,
  };
};

// ─── Get Monthly Attendance ──────────────────────────────────────────────────
const getMonthlyAttendance = async (employeeId, month, year) => {
  const snap = await db.collection('attendance')
    .where('employee_id', '==', employeeId)
    .get();

  const records = snap.docs
    .map(d => d.data())
    .filter(r => {
      const [y, m] = r.date.split('-').map(Number);
      return y === year && m === month;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const summarySnap = await db.collection('monthly_summary')
    .doc(`${employeeId}_${year}_${month}`)
    .get();

  return { records, summary: summarySnap.exists ? summarySnap.data() : null };
};

// ─── Compute Monthly Summary ─────────────────────────────────────────────────
const computeMonthlySummary = async (employeeId, month, year) => {
  const empSnap = await db.collection('employees').doc(employeeId).get();
  const emp = empSnap.data();
  const monthlySalary = parseFloat(emp.monthly_salary || 0);

  // Get attendance records
  const attSnap = await db.collection('attendance').where('employee_id', '==', employeeId).get();
  const records = attSnap.docs.map(d => d.data())
    .filter(r => { const [y, m] = r.date.split('-').map(Number); return y === year && m === month; });

  // Count working days (exclude Sundays & holidays)
  const daysInMonth = moment(`${year}-${month}`, 'YYYY-M').daysInMonth();
  const holidaySnap = await db.collection('holidays').get();
  const holidays = new Set(holidaySnap.docs.map(d => d.data().date));
  let totalWorkingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = moment(`${year}-${month}-${d}`, 'YYYY-M-D');
    if (day.day() !== 0 && !holidays.has(day.format('YYYY-MM-DD'))) totalWorkingDays++;
  }

  const presentDays = records.filter(r => ['present', 'late', 'half_day'].includes(r.status)).length;
  const lateDays = records.filter(r => r.late_minutes > 0).length;
  const halfDays = records.filter(r => r.status === 'half_day').length;
  const appreciationDays = records.filter(r => r.is_appreciated).length;
  const totalWorkingHours = records.reduce((s, r) => s + (r.working_hours || 0), 0);
  const totalLateDeductHours = records.reduce((s, r) => s + (r.late_deduction_hours || 0), 0);

  // Approved leaves this month
  const leaveSnap = await db.collection('leaves')
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'approved')
    .get();
  const leaves = leaveSnap.docs.map(d => d.data())
    .filter(l => {
      const d = l.from_date || l.permission_date;
      if (!d) return false;
      const [y, m] = d.split('-').map(Number);
      return y === year && m === month;
    });

  const earnedLeaveUsed = leaves.filter(l => l.leave_type === 'earned').reduce((s, l) => s + (l.total_days || 0), 0);
  const unpaidLeaveDays = leaves.filter(l => l.leave_type === 'unpaid').reduce((s, l) => s + (l.total_days || 0), 0);
  const permissionHours = leaves.filter(l => l.leave_type === 'permission_hours').reduce((s, l) => s + (l.permission_hours || 0), 0);
  const absentDays = Math.max(0, totalWorkingDays - presentDays - halfDays * 0.5 - earnedLeaveUsed - unpaidLeaveDays);

  const dailyRate = monthlySalary / 30; // Always 30 days divisor
  const hourlyRate = dailyRate / 9; // 9 hours working day

  // 🕒 Late Deduction Logic: 1st & 2nd are free. 3rd+ deducts 1 hour.
  const lateDaysCount = records.filter(r => r.status === 'late').length;
  const taxableLateDays = Math.max(0, lateDaysCount - 2);
  const lateDeduction = parseFloat((taxableLateDays * hourlyRate).toFixed(2));

  // 🌴 Leave Deduction Logic: 1st leave is free.
  const totalLeavesTaken = earnedLeaveUsed + unpaidLeaveDays;
  const taxableLeaveDays = Math.max(0, totalLeavesTaken - 1);
  const leaveDeduction = parseFloat((taxableLeaveDays * dailyRate).toFixed(2));

  const absentDeduction = parseFloat((absentDays * dailyRate).toFixed(2));
  
  const totalDeduction = parseFloat((lateDeduction + leaveDeduction + absentDeduction).toFixed(2));
  const netSalary = parseFloat(Math.max(0, monthlySalary - totalDeduction).toFixed(2));

  const summary = {
    employee_id: employeeId,
    month, year,
    total_working_days: totalWorkingDays,
    present_days: presentDays,
    absent_days: parseFloat(absentDays.toFixed(2)),
    late_days: lateDaysCount,
    taxable_late_days: taxableLateDays,
    leave_days: totalLeavesTaken,
    taxable_leave_days: taxableLeaveDays,
    gross_salary: monthlySalary,
    daily_rate: parseFloat(dailyRate.toFixed(2)),
    hourly_rate: parseFloat(hourlyRate.toFixed(2)),
    late_deduction: lateDeduction,
    leave_deduction: leaveDeduction,
    absent_deduction: absentDeduction,
    total_deduction: totalDeduction,
    net_salary: netSalary,
    updated_at: new Date(),
  };


  await db.collection('monthly_summary')
    .doc(`${employeeId}_${year}_${month}`)
    .set(summary, { merge: true });

  return summary;
};

const getTodayRecord = async (employeeId) => {
  const today = moment().tz(TZ).format('YYYY-MM-DD');
  const snap = await db.collection('attendance').doc(`${employeeId}_${today}`).get();
  return snap.exists ? snap.data() : null;
};

const getAdminToday = async () => {
  const todayStr = moment().tz(TZ).format('YYYY-MM-DD');
  const attSnap = await db.collection('attendance').where('date', '==', todayStr).get();
  const empSnap = await db.collection('employees').where('status', '==', 'active').get();

  const employees = {};
  empSnap.forEach(doc => {
    employees[doc.id] = doc.data();
  });

  let presentCount = 0;
  let lateCount = 0;
  let appreciatedCount = 0;

  const data = attSnap.docs.map(doc => {
    const att = doc.data();
    const emp = employees[att.employee_id] || {};
    
    presentCount++;
    if (att.status === C.STATUS.LATE) lateCount++;
    if (att.is_appreciated) appreciatedCount++;

    return {
      id: doc.id,
      ...att,
      full_name: emp.full_name || null,
      designation: emp.designation || null,
      employee_id: emp.employee_id || att.employee_id // prefer actual employee_id over UID if available
    };
  });

  const summary = {
    present: presentCount,
    absent: Math.max(0, empSnap.size - presentCount),
    late: lateCount,
    appreciated: appreciatedCount
  };

  return { summary, data };
};

module.exports = { checkIn, checkOut, getAdminToday, getMonthlyAttendance, computeMonthlySummary, getTodayRecord };
