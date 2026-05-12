const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { db, auth, messaging } = require('./config/firebase');
const { computeMonthlySummary, autoCheckOutAll } = require('./services/attendanceService');
const moment = require('moment-timezone');
const C = require('./config/constants');
const bcrypt = require('bcryptjs');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'anonymous',
});

app.use('/auth', limiter);


// Routes
app.use('/auth', require('./routes/auth'));
app.use('/attendance', require('./routes/attendance'));
app.use('/leaves', require('./routes/leaves'));
app.use('/employees', require('./routes/employees'));
app.use('/ai', require('./routes/ai'));
app.use('/notifications', require('./routes/notifications'));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Standard Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 API Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Main API export
exports.api = functions.https.onRequest(app);

// ── CRON: Mark absent daily at 9 PM ──────────────────────────────
exports.markAbsentDaily = functions.pubsub
  .schedule('0 21 * * *')
  .timeZone(C.TIMEZONE)
  .onRun(async () => {
    const today = moment().tz(C.TIMEZONE).format('YYYY-MM-DD');
    if (moment().tz(C.TIMEZONE).day() === 0) return null; // Skip Sunday

    const [empsSnap, attSnap, leavesSnap] = await Promise.all([
      db.collection('employees').where('status', '==', 'active').get(),
      db.collection('attendance').where('date', '==', today).get(),
      db.collection('leaves').where('status', '==', 'approved').get(),
    ]);

    const checkedInIds = new Set(attSnap.docs.map(d => d.data().employee_id));
    const onLeaveIds = new Set(
      leavesSnap.docs
        .map(d => d.data())
        .filter(l => l.from_date <= today && (l.to_date || l.from_date) >= today)
        .map(l => l.employee_id)
    );

    const batch = db.batch();
    empsSnap.docs.forEach(emp => {
      if (!checkedInIds.has(emp.id) && !onLeaveIds.has(emp.id)) {
        batch.set(db.collection('attendance').doc(`${emp.id}_${today}`), {
          employee_id: emp.id, date: today, status: 'absent',
          check_in: null, check_out: null, working_hours: 0,
          late_minutes: 0, is_appreciated: false, late_deduction_hours: 0,
          created_at: new Date(), updated_at: new Date(),
        }, { merge: true });
      }
    });
    await batch.commit();
    console.log(`✅ Absent marking done: ${today}`);
    return null;
  });

// ── CRON: Credit 1 earned leave on 1st of every month ────────────
exports.creditMonthlyLeave = functions.pubsub
  .schedule('0 0 1 * *')
  .timeZone(C.TIMEZONE)
  .onRun(async () => {
    const snap = await db.collection('employees').where('status', '==', 'active').get();
    const batch = db.batch();
    snap.docs.forEach(d => {
      batch.update(d.ref, {
        earned_leave_balance: (d.data().earned_leave_balance || 0) + 1,
        updated_at: new Date(),
      });
    });
    await batch.commit();
    console.log(`✅ Leave credited to ${snap.size} employees`);
    return null;
  });

// ── CRON: Compute monthly summary on last day of month ───────────
exports.computeMonthlyEnd = functions.pubsub
  .schedule('0 23 28 * *')
  .timeZone(C.TIMEZONE)
  .onRun(async () => {
    const now = moment().tz(C.TIMEZONE);
    // Only run if today is actually the last day of month
    if (now.date() !== now.daysInMonth()) return null;

    const snap = await db.collection('employees').where('status', '==', 'active').get();
    for (const d of snap.docs) {
      await computeMonthlySummary(d.id, now.month() + 1, now.year()).catch(console.error);
    }
    console.log(`✅ Monthly summary computed for ${snap.size} employees`);
    return null;
  });

// ── CRON: Mark Sunday for all employees ──────────────────────────
exports.markSunday = functions.pubsub
  .schedule('0 0 * * 0')
  .timeZone(C.TIMEZONE)
  .onRun(async () => {
    const today = moment().tz(C.TIMEZONE).format('YYYY-MM-DD');
    const snap = await db.collection('employees').where('status', '==', 'active').get();
    const batch = db.batch();
    snap.docs.forEach(d => {
      batch.set(db.collection('attendance').doc(`${d.id}_${today}`), {
        employee_id: d.id, date: today, status: 'sunday',
        check_in: null, check_out: null, working_hours: 0,
        is_appreciated: false, created_at: new Date(), updated_at: new Date(),
      }, { merge: true });
    });
    await batch.commit();
    return null;
  });

// ── ONE-TIME: Create Super Admin (call once then delete) ──────────
exports.createSuperAdmin = functions.https.onRequest(async (req, res) => {
  // IMPORTANT: Delete this function after first use!
  const SECRET = req.headers['x-setup-secret'] || req.query.secret;
  if (SECRET !== 'setup123') {
    return res.status(403).json({ error: 'Forbidden' });
  }


  try {
    const userRecord = await auth.createUser({
      email: 'admin@company.com',
      password: 'Admin@123',
      displayName: 'Super Admin',
    });
    await auth.setCustomUserClaims(userRecord.uid, { role: 'admin' });
    const hashed = await bcrypt.hash('Admin@123', 12);
    await db.collection('admins').doc(userRecord.uid).set({
      uid: userRecord.uid,
      username: 'admin',
      email: 'admin@company.com',
      password: hashed,
      full_name: 'Super Admin',
      is_super_admin: true,
      is_active: true,
      fcm_token: null,
      created_at: new Date(),
    });

    // Seed departments
    const depts = ['Engineering', 'HR', 'Sales', 'Finance', 'Operations'];
    const batch = db.batch();
    depts.forEach(name => batch.set(db.collection('departments').doc(), { name, is_active: true }));
    await batch.commit();

    res.json({ success: true, message: 'Super admin created. DELETE THIS FUNCTION NOW!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { sendReminders } = require('./services/notificationService');

exports.reminder930 = functions.pubsub.schedule('30 9 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    const imageUrl = 'https://plus.unsplash.com/premium_vector-1776868352127-0ad1a8bb98ad?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0';
    await sendReminders('Check-In Time! 🏢', 'It is 9:30 AM. Don\'t forget to mark your attendance!', imageUrl);
  });


exports.reminder1000 = functions.pubsub.schedule('0 10 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    const imageUrl = 'https://plus.unsplash.com/premium_vector-1745401065827-c3e1772c0972?q=80&w=880&auto=format&fit=crop';
    await sendReminders('Late Warning! ⏰', 'It is 10:00 AM. Check in before 10:10 AM to avoid being blocked!', imageUrl);
  });


exports.reminder1005 = functions.pubsub.schedule('5 10 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    const imageUrl = 'https://media.istockphoto.com/id/1141031241/vector/closing-soon-stamp-on-white.webp?a=1&b=1&s=612x612&w=0&k=20&c=ni9bApruHVK_RPYL995ab1GXbCJMbYufKYSwkq2Ypac=';
    await sendReminders('Check-In Closing Soon! ⚠️', 'It is 10:05 AM. Only 5 minutes left to mark your attendance before it closes!', imageUrl);
  });



exports.reminder1830 = functions.pubsub.schedule('30 18 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    const imageUrl = 'https://plus.unsplash.com/premium_vector-1747381876212-1283f80e5497?w=600&auto=format&fit=crop';
    await sendReminders('Shift Ended 🌅', 'It is 6:30 PM. Great work today! The system will auto check you out if you haven\'t already.', imageUrl);
  });


exports.reminder2200 = functions.pubsub.schedule('0 22 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    const imageUrl = 'https://plus.unsplash.com/premium_vector-1724752200862-0cfaa11fd7d2?w=600&auto=format&fit=crop';
    await sendReminders('Good Night! 🌙', 'It is 10:00 PM. Time to rest and recharge for tomorrow. Have a peaceful sleep!', imageUrl);
  });
