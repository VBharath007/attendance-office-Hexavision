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

    // 2. De-duplicate by TOKEN (ensure only one notification per device)
    // We pick the latest user (UID) who logged into that specific token
    const tokenToLatestSession = {};

    sessionsSnap.forEach(doc => {
      const data = doc.data();
      if (data.fcm_token) {
        const lastLogin = data.last_login ? data.last_login.toDate() : new Date(0);
        
        if (!tokenToLatestSession[data.fcm_token] || lastLogin > tokenToLatestSession[data.fcm_token].lastLogin) {
          tokenToLatestSession[data.fcm_token] = {
            uid: data.uid,
            lastLogin: lastLogin
          };
        }
      }
    });

    const uniqueTokens = Object.keys(tokenToLatestSession);
    if (uniqueTokens.length === 0) return { success: true, message: 'No tokens found' };

    // Get unique UIDs to fetch names
    const uids = [...new Set(uniqueTokens.map(t => tokenToLatestSession[t].uid))];

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
    for (const token of uniqueTokens) {
      const uid = tokenToLatestSession[token].uid;
      const name = uidToName[uid] || 'Team';
      const personalizedBody = `Hi ${name}, ${body}`;
      
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
