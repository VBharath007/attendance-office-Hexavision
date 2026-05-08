const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const serviceAccount = require('./service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

async function fixUser() {
  const hashedPassword = await bcrypt.hash('password123', 12);
  const snapshot = await db.collection('employees').where('employee_id', '==', 'EMP018').get();
  if (!snapshot.empty) {
    await snapshot.docs[0].ref.update({
      password: hashedPassword,
      status: 'active'
    });
    console.log('EMP018 updated with password123');
  } else {
    console.log('EMP018 not found');
  }
}
fixUser().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
