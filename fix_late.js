const admin = require('firebase-admin');
const moment = require('moment-timezone');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();
const TZ = 'Asia/Kolkata';
const today = moment().tz(TZ).format('YYYY-MM-DD');

async function fixTodayLateRecords() {
  console.log(`🔍 Fixing late records for ${today}...`);
  
  const snap = await db.collection('attendance')
    .where('date', '==', today)
    .where('status', '==', 'late')
    .get();

  if (snap.empty) {
    console.log('✅ No late records found for today.');
    return;
  }

  const batch = db.batch();
  let count = 0;

  snap.forEach(doc => {
    const data = doc.data();
    const checkIn = data.check_in;
    
    // If check-in is <= 10:15 AM, change to present
    if (checkIn) {
      const parts = checkIn.split(' ');
      const timePart = parts[0];
      const modifier = parts[1];
      let [h, m] = timePart.split(':').map(Number);
      if (h === 12) h = 0;
      if (modifier === 'PM') h += 12;
      const totalMin = h * 60 + m;

      if (totalMin <= (10 * 60 + 15)) {
        batch.update(doc.ref, { 
          status: 'present',
          late_minutes: 0,
          late_deduction_hours: 0,
          is_warning_day: false
        });
        count++;
      }
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`🚀 Successfully updated ${count} records from LATE to PRESENT.`);
  } else {
    console.log('ℹ️ No records needed updating.');
  }
}

fixTodayLateRecords().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
