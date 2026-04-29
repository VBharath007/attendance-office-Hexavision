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
    credential: admin.credential.cert(serviceAccount)
  });
}


const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Import Routes
const authRoutes = require('./src/routes/auth');
const attendanceRoutes = require('./src/routes/attendance');
const leaveRoutes = require('./src/routes/leaves');
const employeeRoutes = require('./src/routes/employees');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/employees', employeeRoutes);

// Health Check
app.get('/', (req, res) => res.send('Hexavision Attendance API is running! 🚀'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
