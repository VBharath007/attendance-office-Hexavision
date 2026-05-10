const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin with Service Account
// On Railway, you will upload service-account.json or use env vars
let serviceAccount;
try {
  serviceAccount = require('./service-account.json');
} catch (e) {
  // If file is missing (like on Railway), use Environment Variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    console.error('❌ Error: Firebase Service Account not found (File or Env Var missing)');
  }
}



if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}



const app = express();

// Security Middleware
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);


// Import Routes
const authRoutes = require('./src/routes/auth');
const attendanceRoutes = require('./src/routes/attendance');
const leaveRoutes = require('./src/routes/leaves');
const employeeRoutes = require('./src/routes/employees');

// Use Routes
app.use('/api/auth', authRoutes);

// 👑 MASTER SETUP ROUTE
app.get('/setup-admin', async (req, res) => {
  try {
    const { db, auth } = require('./src/config/firebase');
    const bcrypt = require('bcryptjs');

    console.log('🚀 Running Master Setup...');
    const hashed = await bcrypt.hash('admin123', 12);
    const adminData = { username: 'admin', password: hashed, full_name: 'Hexavision Admin', role: 'admin' };

    // Check if exists
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

app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/employees', employeeRoutes);

// Health Check
app.get('/', (req, res) => res.send('Hexavision Attendance API is running! 🚀'));

const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
