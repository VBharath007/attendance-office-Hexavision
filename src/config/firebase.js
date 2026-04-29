const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST;
  
  if (isEmulator) {
    admin.initializeApp({ projectId: 'attendance-office-hexa' });
  } else {
    let serviceAccount;
    try {
      serviceAccount = require('../../service-account.json');
    } catch (e) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      }
    }

    if (serviceAccount) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      admin.initializeApp(); // Fallback for real Functions env
    }
  }


}




const db = admin.firestore();
const auth = admin.auth();
const messaging = admin.messaging();

module.exports = { admin, db, auth, messaging };
