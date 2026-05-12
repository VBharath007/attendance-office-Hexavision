const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin with Service Account
let serviceAccount;
try {
  serviceAccount = require('./service-account.json');
} catch (e) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const app = express();
app.set('trust proxy', 1);
// app.use(helmet()); // Commented out to prevent blocking local Flutter Web requests
app.use(cors({
  origin: true, // Dynamically allow the origin of the request (e.g., localhost:63724)
  credentials: true
}));
app.use(express.json());

// Import Routes
const authRoutes = require('./src/routes/auth');
const attendanceRoutes = require('./src/routes/attendance');
const leaveRoutes = require('./src/routes/leaves');
const employeeRoutes = require('./src/routes/employees');
const notificationRoutes = require('./src/routes/notifications');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/notifications', notificationRoutes);

// 👑 MASTER SETUP ROUTE
app.get('/setup-admin', async (req, res) => {
  try {
    const { db } = require('./src/config/firebase');
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash('Hex@123', 12);
    const adminData = { username: 'admin', password: hashed, full_name: 'Hexavision Admin', role: 'admin' };

    const existing = await db.collection('admins').where('username', '==', 'admin').get();
    if (existing.empty) {
      await db.collection('admins').add(adminData);
      res.send('<h1>✅ Admin Created!</h1><p>Username: <b>admin</b><br>Password: <b>admin123</b></p>');
    } else {
      res.send('<h1>ℹ️ Admin already exists!</h1><p>You can login with <b>admin / admin123</b></p>');
    }
  } catch (err) {
    res.status(500).send('<h1>❌ Setup Failed</h1>' + err.message);
  }
});

// Health Check
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Hexavision Attendance API is running! 🚀' }));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const cron = require('node-cron');
const { sendReminders } = require('./src/services/notificationService');

// ── LOCAL CRON JOBS ──────────────────────────────────────────────
// These simulate Firebase Scheduled Functions locally

// 9:30 AM Reminder
cron.schedule('30 9 * * *', async () => {
  console.log('⏰ Local Cron: Triggering 9:30 AM Reminder');
  const imageUrl = 'https://plus.unsplash.com/premium_vector-1776868352127-0ad1a8bb98ad?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0';
  await sendReminders('Check-In Time! 🏢', 'It is 9:30 AM. Don\'t forget to mark your attendance!', imageUrl);
}, { timezone: "Asia/Kolkata" });

// 10:00 AM Reminder
cron.schedule('0 10 * * *', async () => {
  console.log('⏰ Local Cron: Triggering 10:00 AM Reminder');
  const imageUrl = 'https://plus.unsplash.com/premium_vector-1745401065827-c3e1772c0972?q=80&w=880&auto=format&fit=crop';
  await sendReminders('Late Warning! ⏰', 'It is 10:00 AM. Check in before 10:10 AM to avoid being blocked!', imageUrl);
}, { timezone: "Asia/Kolkata" });

// 10:05 AM Reminder
cron.schedule('5 10 * * *', async () => {
  console.log('⏰ Local Cron: Triggering 10:05 AM Reminder');
  const imageUrl = 'https://media.istockphoto.com/id/1141031241/vector/closing-soon-stamp-on-white.webp?a=1&b=1&s=612x612&w=0&k=20&c=ni9bApruHVK_RPYL995ab1GXbCJMbYufKYSwkq2Ypac=';
  await sendReminders('Check-In Closing Soon! ⚠️', 'It is 10:05 AM. Only 5 minutes left to mark your attendance before it closes!', imageUrl);
}, { timezone: "Asia/Kolkata" });

// 6:30 PM Reminder
cron.schedule('30 18 * * *', async () => {
  console.log('⏰ Local Cron: Triggering 6:30 PM Reminder');
  const imageUrl = 'https://plus.unsplash.com/premium_vector-1747381876212-1283f80e5497?w=600&auto=format&fit=crop';
  await sendReminders('Shift Ended 🌅', 'It is 6:30 PM. Great work today! The system will auto check you out if you haven\'t already.', imageUrl);
}, { timezone: "Asia/Kolkata" });

// 10:00 PM Reminder
cron.schedule('0 22 * * *', async () => {
  console.log('⏰ Local Cron: Triggering 10:00 PM Reminder');
  const imageUrl = 'https://plus.unsplash.com/premium_vector-1724752200862-0cfaa11fd7d2?w=600&auto=format&fit=crop';
  await sendReminders('Good Night! 🌙', 'It is 10:00 PM. Time to rest and recharge for tomorrow. Have a peaceful sleep!', imageUrl);
}, { timezone: "Asia/Kolkata" });

// 🚀 TEMPORARY: 5-Minute Test Reminder (Runs every 5 minutes)
cron.schedule('*/5 * * * *', async () => {
  console.log('⏰ Test Cron: Triggering 5-Minute Reminder');
  const imageUrl = 'https://plus.unsplash.com/premium_vector-1776868352127-0ad1a8bb98ad?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0';
  await sendReminders('5-Min Pulse Check! ⚡', 'This is your real-time 5-minute test notification.', imageUrl);
}, { timezone: "Asia/Kolkata" });

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('🚀 Local Schedulers (Cron) are active!');
});
