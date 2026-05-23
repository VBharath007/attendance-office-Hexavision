const { db } = require('../config/firebase');
const moment = require('moment-timezone');
const C = require('../config/constants');

const TZ = C.TIMEZONE;
const toMin = (t) => {
  if (!t) return 0;
  t = t.trim().toUpperCase();
  // Handle "hh:mm AM/PM" or "hh:mm A/P" format
  if (t.includes(' ')) {
    const parts = t.split(' ');
    const timePart = parts[0];
    const modifier = parts[1];
    let [h, m] = timePart.split(':').map(Number);
    if (h === 12) h = 0;
    // Handle both PM and P
    if (modifier.startsWith('P')) h += 12;
    return h * 60 + m;
  }
  // Handle "HH:mm" format (24h)
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const OFFICE_START = toMin(C.OFFICE_START);
const GRACE = toMin(C.GRACE_TIME);
const OFFICE_END = toMin(C.OFFICE_END);
const APPRECIATION_END = toMin('18:30'); // 6:30 PM in 24h format

// Haversine formula to get distance in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

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

  // Rule 1 & 4: Check-in allowed between 9:30 AM and 6:30 PM
  const allowedStart = toMin('09:30');
  const allowedEnd = OFFICE_END; // 18:30
  const overtimeStart = toMin('18:30');

  const isRegularCheckIn = checkInMin >= allowedStart && checkInMin <= allowedEnd;
  const isOvertimeCheckIn = checkInMin >= overtimeStart;

  if (!isRegularCheckIn && !isOvertimeCheckIn) {
    throw new Error('Check-in is only allowed between 09:30 AM and 06:30 PM');
  }

  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  const data = attSnap.data();

  // ── Handle Overtime Check-In ──
  if (attSnap.exists && data.check_in && data.check_out) {
    if (data.overtime_check_in) throw new Error('Already checked in for overtime today');

    await attRef.update({
      overtime_check_in: timeNow,
      overtime_check_in_timestamp: new Date(),
      overtime_check_in_lat: latitude || null,
      overtime_check_in_lng: longitude || null,
      updated_at: new Date(),
    });

    return {
      isOvertime: true,
      message: '✅ Overtime check-in successful! Good luck with the extra work.',
    };
  }

  if (attSnap.exists && data.check_in) throw new Error('Already checked in today');

  // ... (rest of the logic for normal check-in)
  // Get employee warning state
  const empRef = db.collection('employees').doc(employeeId);
  const empSnap = await empRef.get();
  const emp = empSnap.data();

  const currentMonth = now.month() + 1;
  const currentYear = now.year();
  let warningCount = emp.late_warning_count || 0;

  // Check for approved permission today (Permission, Meeting, or Support)
  const timeBasedTypes = [
    C.LEAVE_TYPES.PERMISSION_HOURS,
    C.LEAVE_TYPES.CLIENT_MEETING,
    C.LEAVE_TYPES.EMPLOYEE_SUPPORT
  ];

  const permSnap = await db.collection('leaves')
    .where('employee_id', '==', employeeId)
    .where('status', '==', 'approved')
    .where('leave_type', 'in', timeBasedTypes)
    .get();

  const permissionsToday = permSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(d => d.permission_date === today);

  // Robust Late Calculation with Permission Overlap
  let totalLateMinutes = Math.max(0, checkInMin - OFFICE_START);
  let overlappingPermissionMinutes = 0;
  let permissionId = null;
  let permissionHours = 0;
  let permissionTo = null;

  permissionsToday.forEach(p => {
    const pFrom = toMin(p.permission_from);
    const pTo = toMin(p.permission_to);
    
    // Overlap between [OFFICE_START, checkInMin] and [pFrom, pTo]
    const overlapStart = Math.max(OFFICE_START, pFrom);
    const overlapEnd = Math.min(checkInMin, pTo);
    
    if (overlapEnd > overlapStart) {
      overlappingPermissionMinutes += (overlapEnd - overlapStart);
      if (!permissionId || (pTo - pFrom > permissionHours * 60)) {
        permissionId = p.id;
        permissionHours = p.permission_hours || 0;
        permissionTo = p.permission_to;
      }
    }
  });

  const effectiveLateMinutes = Math.max(0, totalLateMinutes - overlappingPermissionMinutes);
  const allowedLateMinutes = Math.max(0, GRACE - OFFICE_START);
  const isLate = effectiveLateMinutes > allowedLateMinutes; 
  const lateMinutes = isLate ? effectiveLateMinutes : 0;

  // Reset monthly warning counter
  if (emp.late_warning_reset_month !== currentMonth || emp.late_warning_reset_year !== currentYear) {
    warningCount = 0;
    await empRef.update({ late_warning_count: 0, late_warning_reset_month: currentMonth, late_warning_reset_year: currentYear });
  }

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
    permission_id: permissionId,
    permission_hours: permissionHours,
    permission_to: permissionTo,
    check_out: null,
    working_hours: 0,
    overtime_minutes: 0,
    is_appreciated: false,
    created_at: new Date(),
    updated_at: new Date(),
  }, { merge: true });

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
const checkOut = async (employeeId, latitude, longitude, isAuto = false) => {
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
  
  if (!isWfhApproved) {
    if (isAuto) {
      // For auto-checkout, they MUST be outside the threshold
      if (distance < C.GEOFENCE_THRESHOLD_METERS) {
        return { skipped: true, reason: 'Still within geofence range' };
      }
    } else {
      // For manual checkout, they MUST be inside the office range
      if (distance > C.MAX_DISTANCE_METERS) {
        throw new Error(`Manual check-out requires being at the office. You are ${Math.round(distance)}m away.`);
      }
    }
  }

  const timeNow = now.format('hh:mm A');
  const docId = `${employeeId}_${today}`;

  const attRef = db.collection('attendance').doc(docId);
  const attSnap = await attRef.get();
  if (!attSnap.exists || !attSnap.data().check_in) throw new Error('Please check in first');

  const data = attSnap.data();
  
  // 🕒 Handle Overtime Check-Out
  if (data.check_out && data.overtime_check_in && !data.overtime_check_out) {
    if (isAuto) return { skipped: true, reason: 'Auto check-out not supported for overtime' };
    
    await attRef.update({
      overtime_check_out: timeNow,
      overtime_check_out_timestamp: new Date(),
      overtime_check_out_lat: latitude || null,
      overtime_check_out_lng: longitude || null,
      updated_at: new Date(),
    });

    return {
      isOvertime: true,
      checkOutTime: timeNow,
      message: '✅ Overtime check-out successful! Well done.',
    };
  }

  if (data.check_out && !isAuto) throw new Error('Already checked out today');
  if (data.check_out && isAuto) return { skipped: true, reason: 'Already checked out' };

  const checkInMin = toMin(data.check_in);
  const checkOutMin = toMin(now.format('HH:mm')); // 24h for calculation
  const officeEndMin = toMin(C.OFFICE_END || '18:30');

  // 🕒 Logic: Split between Regular and Overtime
  const regularCheckOutMin = Math.min(checkOutMin, officeEndMin);
  
  // Total Working Hours = (Check-out - Check-in) + Permission Hours
  const actualWorkingMinutes = Math.max(0, regularCheckOutMin - checkInMin);
  const permissionMinutes = (data.permission_hours || 0) * 60;
  const totalEffectiveMinutes = actualWorkingMinutes + permissionMinutes;
  
  const workingHours = parseFloat((totalEffectiveMinutes / 60).toFixed(2));
  
  const overtimeMinutes = Math.max(0, checkOutMin - officeEndMin);

  // 🌟 Appreciation Rule: In by 10:10, Stayed 1 hour extra (7:30 PM)
  const tenTenMin = toMin(C.APPRECIATION_CHECKIN_MAX || '10:10');
  const appreciationMin = toMin(C.APPRECIATION_CHECKOUT_MIN || '19:30');
  const isAppreciated = (checkInMin <= tenTenMin) && (checkOutMin >= appreciationMin);

  let status = data.status;
  // Professional Rule: Minimum 4 Hours for "Present"
  if (workingHours > 0 && workingHours < 4 && status !== C.STATUS.LEAVE) {
    status = C.STATUS.ABSENT;
  }

  const updateData = {
    check_out: timeNow,
    check_out_timestamp: new Date(),
    check_out_lat: latitude || null,
    check_out_lng: longitude || null,
    working_hours: workingHours,
    overtime_minutes: overtimeMinutes,
    is_appreciated: isAppreciated,
    status,
    is_auto_checkout: isAuto,
    updated_at: new Date(),
  };

  await attRef.update(updateData);

  return {
    checkOutTime: timeNow,
    workingHours,
    overtimeMinutes,
    isAppreciated,
    isAuto,
    message: isAppreciated 
      ? `🌟 Outstanding! Appreciation earned. Worked ${workingHours}h + ${overtimeMinutes}m OT.`
      : `✅ Checked out. Worked ${workingHours}h ${overtimeMinutes > 0 ? `+ ${overtimeMinutes}m OT` : ''}`,
  };
};

// ─── Sync Location (Geofence Auto Check-Out) ──────────────────────────────────
const syncLocation = async (employeeId, latitude, longitude) => {
  const now = moment().tz(TZ);
  const today = now.format('YYYY-MM-DD');
  
  const attRef = db.collection('attendance').doc(`${employeeId}_${today}`);
  const attSnap = await attRef.get();
  
  if (!attSnap.exists || !attSnap.data().check_in || attSnap.data().check_out) {
    return { status: 'idle', message: 'No active session to monitor' };
  }

  const distance = getDistance(latitude, longitude, C.OFFICE_LAT, C.OFFICE_LNG);
  
  if (distance > C.GEOFENCE_THRESHOLD_METERS) {
    console.log(`🚀 Geofence Breach: Employee ${employeeId} is ${Math.round(distance)}m away. Triggering Auto Check-Out.`);
    return await checkOut(employeeId, latitude, longitude, true);
  }

  return { status: 'ok', distance: Math.round(distance), message: 'Within range' };
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

    // Rule: Skip employees with approved Client Meeting today
    const clientMeetingSnap = await db.collection('leaves')
      .where('employee_id', '==', data.employee_id)
      .where('status', '==', 'approved')
      .where('leave_type', '==', C.LEAVE_TYPES.CLIENT_MEETING)
      .get();

    const hasClientMeeting = clientMeetingSnap.docs.some(ldoc => {
      const ldata = ldoc.data();
      return today >= ldata.from_date && today <= ldata.to_date;
    });

    if (hasClientMeeting) continue;

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

  const graceMin = toMin(C.GRACE_TIME || '10:10');
  const isLate = checkInMin > graceMin;
  const lateMinutes = isLate ? checkInMin - toMin(C.OFFICE_START) : 0;

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
    const officeEndMin = toMin(C.OFFICE_END || '18:30');
    overtimeMinutes = Math.max(0, checkOutMin - officeEndMin);
    
    // Appreciation Rule: In by 10:10, Out after 07:30 PM (19:30)
    const appreciationInMax = toMin(C.APPRECIATION_CHECKIN_MAX || '10:10');
    const appreciationOutMin = toMin(C.APPRECIATION_CHECKOUT_MIN || '19:30');
    isAppreciated = (checkInMin <= appreciationInMax) && (checkOutMin >= appreciationOutMin);
    
    if (workingHours < 4) status = C.STATUS.ABSENT;
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
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

  const snap = await db.collection('attendance')
    .where('employee_id', '==', employeeId)
    .get();

  const records = snap.docs
    .map(d => d.data())
    .filter(r => r.date >= startDate && r.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const summarySnap = await db.collection('monthly_summary')
    .doc(`${employeeId}_${year}_${month}`)
    .get();

  return { records, summary: summarySnap.exists ? summarySnap.data() : null };
};

// ─── Compute Monthly Summary ─────────────────────────────────────────────────
const computeMonthlySummary = async (employeeId, month, year) => {
  const empSnap = await db.collection('employees').doc(employeeId).get();
  if (!empSnap.exists) {
    console.error(`❌ Employee profile not found for ${employeeId}`);
    return null; // Or return a basic summary with zeros
  }
  const emp = empSnap.data();
  const monthlySalary = parseFloat(emp.monthly_salary || 0);

  // Get attendance records
  const attSnap = await db.collection('attendance').where('employee_id', '==', employeeId).get();
  const records = attSnap.docs.map(d => d.data())
    .filter(r => {
      const [y, m] = r.date.split('-').map(Number);
      return y === year && m === month;
    });

  console.log(`📊 Summary for ${employeeId}: Found ${attSnap.size} total records, ${records.length} for ${month}/${year}`);

  // Get approved leaves
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

  // Create a Map of all approved leave days in the month
  const leaveDatesMap = new Map();
  monthlyLeaves.forEach(l => {
    if (l.leave_type) {
      if (l.from_date && l.to_date) {
        let start = moment(l.from_date);
        let end = moment(l.to_date);
        while (start.isSameOrBefore(end, 'day')) {
          leaveDatesMap.set(start.format('YYYY-MM-DD'), l.leave_type);
          start.add(1, 'days');
        }
      } else if (l.permission_date) {
        leaveDatesMap.set(l.permission_date, l.leave_type);
      }
    }
  });

  // Ensure that every approved leave day has a record in our records list
  leaveDatesMap.forEach((leaveType, dateStr) => {
    const hasRecord = records.some(r => r.date === dateStr);
    if (!hasRecord) {
      records.push({
        employee_id: employeeId,
        date: dateStr,
        status: C.STATUS.LEAVE,
        check_in: null,
        check_out: null,
        working_hours: 0,
        late_minutes: 0,
        is_appreciated: false,
        late_deduction_hours: 0,
        created_at: new Date(),
        updated_at: new Date(),
        isVirtual: true
      });
    }
  });

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
      const dateStr = day.format('YYYY-MM-DD');
      const hasRecord = records.some(r => r.date === dateStr);

      if (day.isAfter(now, 'day')) {
        remainingDays++;
      } else if (day.isSame(now, 'day') && !hasRecord) {
        remainingDays++;
      } else {
        expectedDaysUpToNow++;
      }
    }
  }

  // 🕒 Advanced Re-calculation Logic to ensure 100% accuracy
  const processedRecords = records.map(r => {
    let wh = r.working_hours || 0;
    if (wh === 0 && r.check_in && r.check_out) {
      const inMin = toMin(r.check_in);
      const outMin = toMin(r.check_out);
      const permHours = r.permission_hours || 0;
      wh = parseFloat(((outMin - inMin + permHours * 60) / 60).toFixed(2));
    }

    let status = r.status;
    let lateMinutes = r.late_minutes || 0;
    let lateDeductionHours = r.late_deduction_hours || 0;
    let isWarningDay = r.is_warning_day || false;

    // Apply approved leaves check
    const leaveType = leaveDatesMap.get(r.date);
    if (leaveType) {
      if (['sick', 'casual', 'unpaid', 'earned'].includes(leaveType)) {
        status = C.STATUS.LEAVE;
        lateMinutes = 0;
        lateDeductionHours = 0;
        isWarningDay = false;
        wh = 0;
      } else if (leaveType === 'half_day') {
        status = C.STATUS.HALF_DAY;
      }
    } else if (r.check_in) {
      const checkInMin = toMin(r.check_in);
      const graceMin = toMin(C.GRACE_TIME || '10:10');
      const dateLeaves = monthlyLeaves.filter(l => 
        (l.from_date || l.permission_date) === r.date && l.status === 'approved'
      );
      
      const OFFICE_START = toMin(C.OFFICE_START || '09:30');
      let totalLateMinutes = Math.max(0, checkInMin - OFFICE_START);
      let overlap = 0;
      
      dateLeaves.forEach(l => {
        const pFrom = toMin(l.permission_from);
        const pTo = toMin(l.permission_to);
        const overlapStart = Math.max(OFFICE_START, pFrom);
        const overlapEnd = Math.min(checkInMin, pTo);
        if (overlapEnd > overlapStart) overlap += (overlapEnd - overlapStart);
      });

      const effectiveLate = Math.max(0, totalLateMinutes - overlap);
      const allowedLate = Math.max(0, graceMin - OFFICE_START);
      const isLate = effectiveLate > allowedLate;
      const newStatus = (wh < 4 && r.check_out) ? C.STATUS.ABSENT : (isLate ? C.STATUS.LATE : C.STATUS.PRESENT);
      const recomputedLateMinutes = newStatus === C.STATUS.LATE ? effectiveLate : 0;

      status = newStatus;
      lateMinutes = recomputedLateMinutes;
    }
    return { 
      ...r, 
      working_hours: wh, 
      status: status, 
      late_minutes: lateMinutes,
      late_deduction_hours: lateDeductionHours,
      is_warning_day: isWarningDay
    };
  });

  // Sort and re-evaluate late records chronologically
  const lateRecords = processedRecords
    .filter(r => r.status === C.STATUS.LATE)
    .sort((a, b) => a.date.localeCompare(b.date));

  lateRecords.forEach((r, index) => {
    const lateSeqNum = index + 1;
    r.is_warning_day = lateSeqNum <= (C.LATE_WARNING_DAYS || 3);
    r.late_deduction_hours = r.is_warning_day ? 0 : 1;
  });

  // Ensure non-late records are reset
  processedRecords.forEach(r => {
    if (r.status !== C.STATUS.LATE) {
      r.is_warning_day = false;
      r.late_deduction_hours = 0;
    }
  });

  // 🔥 Auto-sync status and fields back to database
  for (const r of processedRecords) {
    const originalRecord = records.find(orig => orig.date === r.date);
    if (originalRecord) {
      const needsUpdate = 
        originalRecord.isVirtual ||
        originalRecord.status !== r.status ||
        originalRecord.late_minutes !== r.late_minutes ||
        originalRecord.late_deduction_hours !== r.late_deduction_hours ||
        originalRecord.is_warning_day !== r.is_warning_day;

      if (needsUpdate) {
        db.collection('attendance')
          .doc(`${employeeId}_${r.date}`)
          .set({
            employee_id: employeeId,
            date: r.date,
            status: r.status,
            check_in: r.check_in || null,
            check_out: r.check_out || null,
            working_hours: r.working_hours || 0,
            late_minutes: r.late_minutes || 0,
            late_deduction_hours: r.late_deduction_hours || 0,
            is_warning_day: r.is_warning_day || false,
            is_appreciated: r.is_appreciated || false,
            created_at: r.created_at || new Date(),
            updated_at: new Date()
          }, { merge: true })
          .catch(e => console.error(`Sync Error for ${employeeId} on ${r.date}:`, e));
      }
    }
  }

  // Update employee profile late warning count if current month/year
  const currentMonth = now.month() + 1;
  const currentYear = now.year();

  if (parseInt(month) === currentMonth && parseInt(year) === currentYear) {
    db.collection('employees').doc(employeeId).update({
      late_warning_count: lateRecords.length
    }).catch(e => console.error(`Failed to update late_warning_count for ${employeeId}:`, e));
  }

  const presentDays = processedRecords.filter(r =>
    (r.status === C.STATUS.PRESENT || r.status === C.STATUS.LATE || r.status === C.STATUS.HALF_DAY)
  ).length;

  const lateDays = processedRecords.filter(r =>
    r.status === C.STATUS.LATE
  ).length;

  const presentDaysSet = new Set(processedRecords.filter(r =>
    (r.status === C.STATUS.PRESENT || r.status === C.STATUS.LATE || r.status === C.STATUS.HALF_DAY)
  ).map(r => r.date));
  const leaveDaysSet = new Set(leaveDatesMap.keys());

  // More accurate absent count: include today if they checked out and work < 4h
  let actualAbsents = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = moment(`${year}-${month}-${d}`, 'YYYY-M-D');
    const dateStr = day.format('YYYY-MM-DD');
    const isSunday = day.day() === 0;
    const isHoliday = holidays.has(dateStr);

    if (day.isBefore(now, 'day')) {
      if (!isSunday && !isHoliday && !presentDaysSet.has(dateStr) && !leaveDatesMap.has(dateStr)) {
        actualAbsents++;
      }
    } else if (day.isSame(now, 'day')) {
      // If today and they checked out but didn't meet 4h requirement
      const todayRecord = records.find(r => r.date === dateStr);
      if (!isSunday && !isHoliday && (!presentDaysSet.has(dateStr) && !leaveDatesMap.has(dateStr) && todayRecord && todayRecord.check_out)) {
        actualAbsents++;
      }
    }
  }

  const halfDays = processedRecords.filter(r => r.status === 'half_day').length;
  const appreciationDays = processedRecords.filter(r => r.is_appreciated).length;

  // Leave calculations
  const sickLeavesTakenThisMonth = monthlyLeaves.filter(l => l.leave_type === 'sick').length;
  const casualLeavesTakenThisMonth = monthlyLeaves.filter(l => l.leave_type === 'casual').length;
  const permissionLeavesThisMonth = monthlyLeaves.filter(l => l.leave_type === 'permission');
  const unpaidLeaveDays = monthlyLeaves.filter(l => l.leave_type === 'unpaid').length;
  const leaveHalfDays = monthlyLeaves.filter(l => l.leave_type === 'half_day').length;

  const sickLeavesTakenThisYear = yearlyLeaves.filter(l => l.leave_type === 'sick').length;
  const taxableSickDays = Math.max(0, sickLeavesTakenThisYear - (C.SICK_LEAVES_PER_YEAR || 12));
  const taxableCasualDays = Math.max(0, casualLeavesTakenThisMonth - (C.CASUAL_LEAVES_PER_MONTH || 1));

  const totalPermissionMinutes = permissionLeavesThisMonth.reduce((s, l) => s + (l.duration_minutes || 0), 0);
  const taxablePermissionMinutes = Math.max(0, totalPermissionMinutes - (C.FREE_PERMISSION_MIN_PER_MONTH || 60));
  const taxablePermissionHours = taxablePermissionMinutes / 60;

  const totalHalfDaysCount = halfDays + leaveHalfDays;
  const halfDayDeductionDays = totalHalfDaysCount > 2 ? totalHalfDaysCount * 0.5 : 0;

  const leaveDaysSum = sickLeavesTakenThisMonth + casualLeavesTakenThisMonth + unpaidLeaveDays + leaveHalfDays * 0.5;

  const totalWorkingHours = processedRecords.reduce((s, r) => s + (r.working_hours || 0), 0);

  const dailyRate = monthlySalary > 0 && daysInMonth > 0 ? monthlySalary / daysInMonth : 0;
  const hourlyRate = dailyRate > 0 ? dailyRate / 9 : 0; // 9 hours working day

  // 🕒 Late Arrival Logic
  const lateDaysCount = lateRecords.length;
  const taxableLateDays = Math.max(0, lateDaysCount - (C.LATE_WARNING_DAYS || 3));
  const lateDeduction = Math.max(0, parseFloat((taxableLateDays * hourlyRate).toFixed(2)) || 0);

  try {
    // Deductions
    const sickDeduction = Math.max(0, parseFloat(((taxableSickDays || 0) * (dailyRate || 0)).toFixed(2)) || 0);
    const casualDeduction = Math.max(0, parseFloat(((taxableCasualDays || 0) * (dailyRate || 0)).toFixed(2)) || 0);
    const unpaidLeaveDeduction = Math.max(0, parseFloat(((unpaidLeaveDays || 0) * (dailyRate || 0)).toFixed(2)) || 0);
    const permissionDeduction = Math.max(0, parseFloat(((taxablePermissionHours || 0) * (hourlyRate || 0)).toFixed(2)) || 0);
    const halfDayDeduction = Math.max(0, parseFloat(((halfDayDeductionDays || 0) * (dailyRate || 0)).toFixed(2)) || 0);
    const absentDeduction = Math.max(0, parseFloat(((actualAbsents || 0) * (dailyRate || 0)).toFixed(2)) || 0);

    const leaveDeduction = Math.max(0, parseFloat((sickDeduction + casualDeduction + unpaidLeaveDeduction + permissionDeduction + halfDayDeduction).toFixed(2)) || 0);
    const totalDeduction = Math.max(0, parseFloat((lateDeduction + leaveDeduction + absentDeduction).toFixed(2)) || 0);
    const netSalary = Math.max(0, parseFloat(((monthlySalary || 0) - totalDeduction).toFixed(2)) || 0);

    const summary = {
      employee_id: employeeId,
      month: parseInt(month),
      year: parseInt(year),
      total_working_days: totalWorkingDays || 0,
      present_days: presentDays || 0,
      absent_days: actualAbsents || 0,
      remaining_days: remainingDays || 0,
      late_days: lateDays || 0,
      taxable_late_days: taxableLateDays || 0,
      leave_days: parseFloat((sickLeavesTakenThisMonth + casualLeavesTakenThisMonth + unpaidLeaveDays + leaveHalfDays * 0.5).toFixed(2)) || 0,
      taxable_leave_days: (taxableSickDays || 0) + (taxableCasualDays || 0) + (unpaidLeaveDays || 0),
      sick_leave_used_year: sickLeavesTakenThisYear || 0,
      casual_leave_used_month: casualLeavesTakenThisMonth || 0,
      gross_salary: monthlySalary || 0,
      daily_rate: parseFloat((dailyRate || 0).toFixed(2)),
      hourly_rate: parseFloat((hourlyRate || 0).toFixed(2)),
      late_deduction: lateDeduction || 0,
      leave_deduction: leaveDeduction || 0,
      absent_deduction: absentDeduction || 0,
      total_deduction: totalDeduction || 0,
      net_salary: netSalary || 0,
      total_working_hours: parseFloat((totalWorkingHours || 0).toFixed(2)),
      total_expected_hours: (totalWorkingDays || 0) * 9,
      overtime_minutes: records.reduce((s, r) => s + (r.overtime_minutes || 0), 0),
      appreciated_count: appreciationDays || 0,
      days_in_month: daysInMonth || 30,
      updated_at: new Date(),
    };

    await db.collection('monthly_summary')
      .doc(`${employeeId}_${year}_${month}`)
      .set(summary, { merge: true });

    return summary;
  } catch (err) {
    console.error(`❌ computeMonthlySummary CRASH for ${employeeId}:`, err);
    return null;
  }
};

const getTodayRecord = async (employeeId) => {
  const today = moment().tz(TZ).format('YYYY-MM-DD');
  const snap = await db.collection('attendance').doc(`${employeeId}_${today}`).get();
  if (!snap.exists) return null;

  const data = snap.data();
  // 🔥 SMART FIX: If working_hours is 0 but they have both check-in and out, calculate it on the fly!
  if ((!data.working_hours || data.working_hours === 0) && data.check_in && data.check_out) {
    const inMin = toMin(data.check_in);
    const outMin = toMin(data.check_out);
    data.working_hours = parseFloat(Math.max(0, (outMin - inMin) / 60).toFixed(2));
  }

  return data;
};

const getAdminToday = async () => {
  const now = moment().tz(TZ);
  const todayStr = now.format('YYYY-MM-DD');
  const currentMonth = now.month() + 1;
  const currentYear = now.year();

  const attSnap = await db.collection('attendance').where('date', '==', todayStr).get();
  const empSnap = await db.collection('employees').where('status', '==', 'active').get();
  
  // Fetch monthly summaries for all employees for the current month
  const summarySnap = await db.collection('monthly_summary')
    .where('month', '==', currentMonth)
    .where('year', '==', currentYear)
    .get();

  const summaries = {};
  summarySnap.forEach(doc => {
    const s = doc.data();
    summaries[s.employee_id] = s;
  });

  const employees = {};
  empSnap.forEach(doc => {
    employees[doc.id] = doc.data();
  });

  let presentCount = 0;
  let lateCount = 0;
  let appreciatedCount = 0;
  let halfDayCount = 0;

  const attendanceData = {};
  attSnap.docs.forEach(doc => {
    attendanceData[doc.data().employee_id] = doc.data();
  });

  const data = empSnap.docs.map(doc => {
    const empId = doc.id;
    const emp = doc.data();
    const att = attendanceData[empId] || { status: 'absent' };
    const summary = summaries[empId] || { present_days: 0, total_working_days: 0 };

    // 🔥 SMART FIX: Re-calculate hours if zero but checked out
    if ((!att.working_hours || att.working_hours === 0) && att.check_in && att.check_out) {
      const inMin = toMin(att.check_in);
      const outMin = toMin(att.check_out);
      att.working_hours = parseFloat(Math.max(0, (outMin - inMin) / 60).toFixed(2));
    }

    if (att.status === C.STATUS.PRESENT || att.status === C.STATUS.LATE) presentCount++;
    if (att.status === C.STATUS.LATE) lateCount++;
    if (att.status === C.STATUS.HALF_DAY) halfDayCount++;
    if (att.is_appreciated) appreciatedCount++;

    return {
      id: empId,
      ...att,
      full_name: emp.full_name || 'Staff',
      designation: emp.designation || 'Employee',
      employee_id: emp.employee_id || empId,
      present_days: summary.present_days || 0,
      total_month_days: summary.total_working_days || 26
    };
  });

  const activeStaffCount = empSnap.size;
  const absentCount = Math.max(0, activeStaffCount - (presentCount + halfDayCount));

  return {
    summary: {
      total: activeStaffCount,
      present: presentCount,
      absent: absentCount,
      late: lateCount,
      appreciated: appreciatedCount,
      halfDay: halfDayCount
    },
    data
  };
};

module.exports = { checkIn, checkOut, autoCheckOutAll, editAttendanceTiming, getAdminToday, getMonthlyAttendance, computeMonthlySummary, getTodayRecord, syncLocation };
