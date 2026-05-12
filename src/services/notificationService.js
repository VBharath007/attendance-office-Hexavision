const { db, messaging } = require('../config/firebase');

/**
 * Sends push notifications to all employees with active sessions.
 * @param {string} title 
 * @param {string} body 
 * @param {string} imageUrl 
 */
const sendReminders = async (title, body, imageUrl = null) => {
  try {
    // 1. Get all active sessions with FCM tokens
    const sessionsSnap = await db.collection('sessions')
      .where('is_active', '==', true)
      .get();

    if (sessionsSnap.empty) {
      console.log('ℹ️ No active sessions found.');
      return { success: true, message: 'No active sessions' };
    }

    // 2. Group tokens by UID to avoid duplicate fetches
    const uidToTokens = {};
    sessionsSnap.forEach(doc => {
      const data = doc.data();
      if (data.fcm_token) {
        if (!uidToTokens[data.uid]) uidToTokens[data.uid] = [];
        uidToTokens[data.uid].push(data.fcm_token);
      }
    });

    const uids = Object.keys(uidToTokens);
    if (uids.length === 0) return { success: true, message: 'No tokens found' };

    // 3. Fetch employee names in chunks (Firestore 'in' query limit is 30)
    const uidToName = {};
    const chunkSize = 30;
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);
      const empsSnap = await db.collection('employees')
        .where('uid', 'in', chunk)
        .get();
      
      empsSnap.forEach(doc => {
        const data = doc.data();
        // Get only the first name for a friendly "Hi Name"
        const firstName = data.full_name ? data.full_name.split(' ')[0] : 'Member';
        uidToName[doc.id] = firstName;
      });
    }

    // 4. Build individual personalized messages
    const messages = [];
    for (const uid of uids) {
      const name = uidToName[uid] || 'Team';
      const personalizedBody = `Hi ${name}, ${body}`;
      
      uidToTokens[uid].forEach(token => {
        const msg = {
          token: token,
          notification: { 
            title: title, 
            body: personalizedBody 
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            }
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                'mutable-content': 1
              }
            }
          }
        };

        if (imageUrl) {
          msg.notification.imageUrl = imageUrl;
          msg.android.notification = { ...msg.android.notification, imageUrl: imageUrl };
          msg.apns.fcm_options = { image: imageUrl };
        }

        messages.push(msg);
      });
    }

    console.log(`🔔 Sending ${messages.length} personalized reminders...`);

    // 5. Send messages using sendEach (v1 API)
    const response = await messaging.sendEach(messages);
    
    console.log(`✅ Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
    
    return { 
      success: true, 
      sentCount: response.successCount, 
      failureCount: response.failureCount 
    };

  } catch (error) {
    console.error('❌ Error in sendReminders:', error);
    return { success: false, error: error.message };
  }
};

module.exports = { sendReminders };
