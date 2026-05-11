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

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
