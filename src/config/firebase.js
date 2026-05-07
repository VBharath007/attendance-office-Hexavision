const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  if (isEmulator) {
    console.log('🧪 Using Firebase Emulator');
    admin.initializeApp({ projectId: 'attendance-2333a' });
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
      console.log('✅ Initializing with Service Account for Project:', serviceAccount.project_id);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    } else {
      console.log('⚠️ No service account found, using default initialization');
      admin.initializeApp();
    }


  }


}




const db = admin.firestore();
const auth = admin.auth();
const messaging = admin.messaging();

module.exports = { admin, db, auth, messaging };
