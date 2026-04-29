const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST;
  
  if (isEmulator) {
    admin.initializeApp({ projectId: 'attendance-office-hexa' });
  } else {
    try {
      // Try to load service-account.json (for local/Railway with file)
      const serviceAccount = require('../../service-account.json');
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      // Fallback to default (for real Firebase Functions environment)
      admin.initializeApp();
    }
  }

}




const db = admin.firestore();
const auth = admin.auth();
const messaging = admin.messaging();

module.exports = { admin, db, auth, messaging };
