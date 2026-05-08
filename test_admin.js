const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

async function checkAdmins() {
  const snapshot = await db.collection('admins').get();
  snapshot.forEach(doc => {
    console.log(doc.id, '=>', doc.data().username);
  });
}
checkAdmins().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
