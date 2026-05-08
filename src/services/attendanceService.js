const { db } = require('../config/firebase');
const moment = require('moment-timezone');
const C = require('../config/constants');

const TZ = C.TIMEZONE;
const toMin = (t) => { 
  if (!t) return 0;
  // Handle "hh:mm AM/PM" format
  if (t.includes(' ')) {
    const parts = t.split(' ');
    const timePart = parts[0];
    const modifier = parts[1].toUpperCase();
    let [h, m] = timePart.split(':').map(Number);
    if (h === 12) h = 0;
    if (modifier === 'PM') h += 12;
    return h * 60 + m;
  }
  // Handle "HH:mm" format (24h)
  const [h, m] = t.split(':').map(Number); 
  return h * 60 + m; 
};

const OFFICE_START = toMin(C.OFFICE_START);
const GRACE = toMin(C.GRACE_TIME);
const OFFICE_END = toMin(C.OFFICE_END);
const APPRECIATION_END = toMin('18:30'); // New rule: Appreciation starts at 6:30 PM

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

  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');

  // Check for approved WFH leave
  const wfhSnap = await db.collection('leaves')
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'approved')
    .where('leave_type', '==', 'work_from_home')
    .get();
    
  const isWfhApproved = wfhSnap.docs.some(doc => {
    const data = doc.data();
    return today >= data.from_date && today <= data.to_date;
  });

  const distance = getDistance(latitude, longitude, C.OFFICE_LAT, C.OFFICE_LNG);
  if (!isWfhApproved && distance > C.MAX_DISTANCE_METERS) {
    throw new Error(`You must be within ${C.MAX_DISTANCE_METERS} meters of the office. You are ${Math.round(distance)} meters away.`);
  }
  const timeNow = now.format('hh:mm A');
  const checkInMin = toMin(now.format('HH:mm')); // For logic, use precise 24h from moment
  const docId = `${employeeId}_${today}`;

  if (now.day() === 0) throw new Error('Today is Sunday - no check-in required');

  // Rule 1 & 4: Check-in only allowed between 9:30 AM and 10:10 AM (Regular) or after 6:30 PM (Overtime)
  const allowedStart = toMin('09:30');
  const allowedEnd = toMin('10:10');
  const overtimeStart = toMin('18:30');
  
  const isRegularCheckIn = checkInMin >= allowedStart && checkInMin <= allowedEnd;
  const isOvertimeCheckIn = checkInMin >= overtimeStart;

  if (!isRegularCheckIn && !isOvertimeCheckIn) {
    throw new Error('Check-in is only allowed between 09:30 AM and 10:10 AM or after 06:30 PM');
  }

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
    status: isOvertimeCheckIn ? 'present' : (isLate ? C.STATUS.LATE : C.STATUS.PRESENT),
    is_overtime_entry: isOvertimeCheckIn,
    is_appreciated: isOvertimeCheckIn,
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

  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');

  const wfhSnap = await db.collection('leaves')
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'approved')
    .where('leave_type', '==', 'work_from_home')
    .get();
    
  const isWfhApproved = wfhSnap.docs.some(doc => {
    const data = doc.data();
    return today >= data.from_date && today <= data.to_date;
  });

  const distance = getDistance(latitude, longitude, C.OFFICE_LAT, C.OFFICE_LNG);
  if (!isWfhApproved && distance > C.MAX_DISTANCE_METERS) {
    throw new Error(`You must be within ${C.MAX_DISTANCE_METERS} meters of the office. You are ${Math.round(distance)} meters away.`);
  }

  const timeNow = now.format('hh:mm A');
  const docId = `${employeeId}_${today}`;

  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  if (!attSnap.exists || !attSnap.data().check_in) throw new Error('Please check in first');
  if (attSnap.data().check_out) throw new Error('Already checked out today');

  const data = attSnap.data();
  const checkInMin = toMin(data.check_in);
  const checkOutMin = toMin(now.format('HH:mm'));

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

// ─── Auto Check Out All (Scheduled) ──────────────────────────────────────────
const autoCheckOutAll = async () => {
  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');
  
  // Rule: Auto-checkout at exactly 18:30 (6:30 PM)
  const timeNow = '06:30 PM';
  const checkOutMin = toMin('18:30');

  const snap = await db.collection('attendance')
    .where('date', '==', today)
    .where('check_out', '==', null)
    .get();

  if (snap.empty) return { processed: 0 };

  const batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.check_in) continue;

    const checkInMin = toMin(data.check_in);
    const rawMinutes = checkOutMin - checkInMin;
    const workingHours = parseFloat(Math.max(0, rawMinutes / 60 - C.LUNCH_BREAK_HOURS).toFixed(2));
    const overtimeMinutes = 0; // Since it's exactly 18:30, no overtime.
    
    let status = data.status;
    if (workingHours < 4) status = C.STATUS.HALF_DAY;

    batch.update(doc.ref, {
      check_out: timeNow,
      check_out_timestamp: new Date(),
      check_out_lat: null,
      check_out_lng: null,
      working_hours: workingHours,
      overtime_minutes: overtimeMinutes,
      is_appreciated: false,
      status,
      updated_at: new Date(),
    });
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }
  return { processed: count };
};

// ─── Admin Edit Attendance Timing ────────────────────────────────────────────
const editAttendanceTiming = async (employeeId, date, checkInTime, checkOutTime) => {
  const docId = `${employeeId}_${date}`;
  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  
  if (!attSnap.exists) {
    throw new Error('Attendance record not found for this date.');
  }

  const data = attSnap.data();
  const checkInMin = toMin(checkInTime);
  const checkOutMin = checkOutTime ? toMin(checkOutTime) : null;

  // Recalculate Late
  const isLate = checkInMin > GRACE;
  const lateMinutes = isLate ? checkInMin - OFFICE_START : 0;
  
  // Recalculate Work Hours & Overtime
  let workingHours = 0;
  let overtimeMinutes = 0;
  let isAppreciated = false;
  let status = isLate ? C.STATUS.LATE : C.STATUS.PRESENT;

  if (checkOutMin) {
    const rawMinutes = checkOutMin - checkInMin;
    const rawHours = rawMinutes / 60;
    // Only subtract lunch break if worked more than 6 hours
    const lunchDeduction = rawHours > 6 ? C.LUNCH_BREAK_HOURS : 0;
    workingHours = parseFloat(Math.max(0, rawHours - lunchDeduction).toFixed(2));
    overtimeMinutes = Math.max(0, checkOutMin - OFFICE_END);
    isAppreciated = lateMinutes === 0 && checkOutMin >= APPRECIATION_END;
    if (workingHours < 4) status = C.STATUS.HALF_DAY;
  }

  await attRef.update({
    check_in: checkInTime,
    check_out: checkOutTime || null,
    late_minutes: lateMinutes,
    late_deduction_hours: isLate && !data.is_warning_day ? 1 : 0,
    working_hours: workingHours,
    overtime_minutes: overtimeMinutes,
    is_appreciated: isAppreciated,
    status,
    updated_at: new Date(),
  });

  return { message: 'Attendance timing updated successfully.' };
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
  let expectedDaysUpToNow = 0;
  let remainingDays = 0;
  const now = moment().tz(TZ);
  
  for (let d = 1; d <= daysInMonth; d++) {
    const day = moment(`${year}-${month}-${d}`, 'YYYY-M-D');
    const isSunday = day.day() === 0;
    const isHoliday = holidays.has(day.format('YYYY-MM-DD'));
    
    if (!isSunday && !isHoliday) {
      totalWorkingDays++;
      if (day.isSame(now, 'day') || day.isAfter(now, 'day')) {
        remainingDays++;
      } else {
        expectedDaysUpToNow++;
      }
    }
  }
  
  const presentDaysSet = new Set(records.map(r => r.date));
  const leaveDaysSet = new Set(monthlyLeaves.flatMap(l => {
    // If leave has a date range, expansion is needed, but assuming simple for now
    return [l.date]; // Simplified for now, usually leaves have a date field
  }));
  
  // More accurate absent count: days before today that are not Sunday, not Holiday, and have no record
  let actualAbsents = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = moment(`${year}-${month}-${d}`, 'YYYY-M-D');
    if (day.isBefore(now, 'day')) {
      const dateStr = day.format('YYYY-MM-DD');
      const isSunday = day.day() === 0;
      const isHoliday = holidays.has(dateStr);
      if (!isSunday && !isHoliday && !presentDaysSet.has(dateStr)) {
        actualAbsents++;
      }
    }
  }

  const presentDays = records.filter(r => ['present', 'late', 'half_day'].includes(r.status)).length;
  const lateDays = records.filter(r => r.late_minutes > 0).length;
  const halfDays = records.filter(r => r.status === 'half_day').length;
  const appreciationDays = records.filter(r => r.is_appreciated).length;
  
  const totalWorkingHours = records.reduce((s, r) => {
    let wh = r.working_hours;
    // If working_hours is missing or 0 but we have check_in and check_out, re-calculate it on the fly
    if ((!wh || wh === 0) && r.check_in && r.check_out) {
      const inMin = toMin(r.check_in);
      const outMin = toMin(r.check_out);
      if (outMin > inMin) {
        const rawHrs = (outMin - inMin) / 60;
        const lunchDed = rawHrs > 6 ? C.LUNCH_BREAK_HOURS : 0;
        wh = parseFloat(Math.max(0, rawHrs - lunchDed).toFixed(2));
      }
    }
    return s + (wh || 0);
  }, 0);
  const totalLateDeductHours = records.reduce((s, r) => s + (r.late_deduction_hours || 0), 0);

  // Approved leaves for the year
  const yearlyLeaveSnap = await db.collection('leaves')
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'approved')
    .get();

  const yearlyLeaves = yearlyLeaveSnap.docs.map(d => d.data())
    .filter(l => {
      const d = l.from_date || l.permission_date;
      if (!d) return false;
      return parseInt(d.split('-')[0]) === year;
    });

  const monthlyLeaves = yearlyLeaves.filter(l => {
    const d = l.from_date || l.permission_date;
    return parseInt(d.split('-')[1]) === month;
  });

  // Calculate Sick Leaves (12 per year, but isolated deduction for this month)
  const sickLeavesTakenThisYear = yearlyLeaves.filter(l => l.leave_type === 'sick').reduce((s, l) => s + (l.total_days || 0), 0);
  const sickLeavesTakenThisMonth = monthlyLeaves.filter(l => l.leave_type === 'sick').reduce((s, l) => s + (l.total_days || 0), 0);
  const sickLeavesBeforeThisMonth = Math.max(0, sickLeavesTakenThisYear - sickLeavesTakenThisMonth);
  
  // Taxable sick days this month: Any sick leave taken AFTER the 12-day yearly limit is reached.
  // Example: used 10 before this month, take 5 this month. 12-10=2 free days left. 5-2=3 taxable days.
  const freeSickDaysRemaining = Math.max(0, 12 - sickLeavesBeforeThisMonth);
  const taxableSickDays = Math.max(0, sickLeavesTakenThisMonth - freeSickDaysRemaining);

  // Calculate Casual Leaves (1 per month limit)
  const casualLeavesTakenThisMonth = monthlyLeaves.filter(l => l.leave_type === 'casual').reduce((s, l) => s + (l.total_days || 0), 0);
  const taxableCasualDays = Math.max(0, casualLeavesTakenThisMonth - 1);

  // Unpaid Leaves
  const unpaidLeaveDays = monthlyLeaves.filter(l => l.leave_type === 'unpaid').reduce((s, l) => s + (l.total_days || 0), 0);

  // Half Days
  const leaveHalfDays = monthlyLeaves.filter(l => l.leave_type === 'half_day').length;
  const totalHalfDaysCount = halfDays + leaveHalfDays;
  const halfDayDeductionDays = totalHalfDaysCount * 0.5;

  // Permission Hours
  const permissionLeaves = monthlyLeaves.filter(l => l.leave_type === 'permission_hours').sort((a, b) => a.permission_date.localeCompare(b.permission_date));
  const distinctPermissionDays = [...new Set(permissionLeaves.map(l => l.permission_date))];
  
  let taxablePermissionHours = 0;
  if (distinctPermissionDays.length > 3) {
    const taxableDays = new Set(distinctPermissionDays.slice(3));
    taxablePermissionHours = permissionLeaves
      .filter(l => taxableDays.has(l.permission_date))
      .reduce((s, l) => s + (l.permission_hours || 0), 0);
  }

  // Absent days (unrecorded)
  const unrecordedDays = Math.max(0, totalWorkingDays - presentDays - totalHalfDaysCount * 0.5 - sickLeavesTakenThisMonth - casualLeavesTakenThisMonth - unpaidLeaveDays);

  const dailyRate = monthlySalary / 30; // Always 30 days divisor
  const hourlyRate = dailyRate / 9; // 9 hours working day

  // 🕒 Late Deduction Logic: 1st & 2nd are free. 3rd+ deducts 1 hour.
  // 🕒 Late Arrival Logic: Count all days where employee was late
  const lateDaysCount = records.filter(r => (r.late_minutes || 0) > 0).length;
  // Taxable lates: only those that are NOT warning days
  const taxableLateDays = records.filter(r => (r.late_minutes || 0) > 0 && !r.is_warning_day).length;
  const lateDeduction = parseFloat((taxableLateDays * hourlyRate).toFixed(2));

  // Deductions
  const sickDeduction = parseFloat((taxableSickDays * dailyRate).toFixed(2));
  const casualDeduction = parseFloat((taxableCasualDays * dailyRate).toFixed(2));
  const unpaidLeaveDeduction = parseFloat((unpaidLeaveDays * dailyRate).toFixed(2));
  const permissionDeduction = parseFloat((taxablePermissionHours * hourlyRate).toFixed(2));
  const halfDayDeduction = parseFloat((halfDayDeductionDays * dailyRate).toFixed(2));
  const unrecordedDays = actualAbsents; // Only past days
  const absentDeduction = parseFloat((unrecordedDays * dailyRate).toFixed(2));
  
  const leaveDeduction = parseFloat((sickDeduction + casualDeduction + unpaidLeaveDeduction + permissionDeduction + halfDayDeduction).toFixed(2));
  const totalDeduction = parseFloat((lateDeduction + leaveDeduction + absentDeduction).toFixed(2));
  const netSalary = parseFloat(Math.max(0, monthlySalary - totalDeduction).toFixed(2));

  const summary = {
    employee_id: employeeId,
    month, year,
    total_working_days: totalWorkingDays,
    present_days: presentDays,
    absent_days: actualAbsents,
    remaining_days: remainingDays,
    late_days: lateDaysCount,
    taxable_late_days: taxableLateDays,
    leave_days: sickLeavesTakenThisMonth + casualLeavesTakenThisMonth + unpaidLeaveDays + leaveHalfDays * 0.5,
    taxable_leave_days: taxableSickDays + taxableCasualDays + unpaidLeaveDays,
    sick_leave_used_year: sickLeavesTakenThisYear,
    casual_leave_used_month: casualLeavesTakenThisMonth,
    gross_salary: monthlySalary,
    daily_rate: parseFloat(dailyRate.toFixed(2)),
    hourly_rate: parseFloat(hourlyRate.toFixed(2)),
    late_deduction: lateDeduction,
    leave_deduction: leaveDeduction,
    absent_deduction: absentDeduction,
    total_deduction: totalDeduction,
    net_salary: netSalary,
    total_working_hours: parseFloat(totalWorkingHours.toFixed(2)),
    overtime_minutes: records.reduce((s, r) => s + (r.overtime_minutes || 0), 0),
    appreciated_count: appreciationDays,
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
      check_in_formatted: att.check_in_timestamp ? moment(att.check_in_timestamp.toDate()).tz(TZ).format('DD MMM YYYY, hh:mm A') : null,
      check_out_formatted: att.check_out_timestamp ? moment(att.check_out_timestamp.toDate()).tz(TZ).format('DD MMM YYYY, hh:mm A') : null,
      full_name: emp.full_name || null,
      designation: emp.designation || null,
      employee_id: emp.employee_id || att.employee_id 
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

module.exports = { checkIn, checkOut, autoCheckOutAll, editAttendanceTiming, getAdminToday, getMonthlyAttendance, computeMonthlySummary, getTodayRecord };
