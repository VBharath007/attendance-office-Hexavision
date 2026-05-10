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
app.use(cors({ origin: true, credentials: true }));
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

// 2. Notification Reminders (9:30 AM, 10:00 AM, 10:10 AM, 6:30 PM)
const sendReminders = async (title, body) => {
  // Only send to employees with active sessions
  const sessionsSnap = await db.collection('sessions')
    .where('is_active', '==', true)
    .get();
  
  const tokens = [];
  sessionsSnap.forEach(doc => {
    const data = doc.data();
    if (data.fcm_token) tokens.push(data.fcm_token);
  });

  if (tokens.length > 0) {
    // Remove duplicates
    const uniqueTokens = [...new Set(tokens)];
    await messaging.sendEachForMulticast({
      tokens: uniqueTokens,
      notification: { title, body },
      android: { priority: 'high' }
    });
  }
};

exports.reminder930 = functions.pubsub.schedule('30 9 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    await sendReminders('Check-In Time! 🏢', 'It is 9:30 AM. Don\'t forget to mark your attendance!');
  });

exports.reminder1000 = functions.pubsub.schedule('0 10 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    await sendReminders('Late Warning! ⏰', 'It is 10:00 AM. Check in before 10:10 AM to avoid being blocked!');
  });

exports.reminder1010 = functions.pubsub.schedule('10 10 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    await sendReminders('Check-In Closed 🔒', 'It is 10:10 AM. Check-in for today is now closed.');
  });

exports.reminder1830 = functions.pubsub.schedule('30 18 * * *')
  .timeZone(C.TIMEZONE).onRun(async () => {
    await sendReminders('Shift Ended 🌅', 'It is 6:30 PM. Great work today! The system will auto check you out if you haven\'t already.');
  });
