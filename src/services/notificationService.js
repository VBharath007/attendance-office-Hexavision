const { db, messaging } = require('../config/firebase');

/**
 * Sends push notifications to all employees with active sessions.
 * @param {string} title 
 * @param {string} body 
 * @param {string} imageUrl 
 */
const sendReminders = async (title, body, imageUrl = null) => {
  try {
    // Only send to employees with active sessions
    const sessionsSnap = await db.collection('sessions')
      .where('is_active', '==', true)
      .get();

    const tokens = [];
    sessionsSnap.forEach(doc => {
      const data = doc.data();
      if (data.fcm_token) tokens.push(data.fcm_token);
    });

    if (tokens.length === 0) {
      console.log('ℹ️ No active sessions with FCM tokens found.');
      return { success: true, message: 'No active sessions' };
    }

    // Remove duplicates
    const uniqueTokens = [...new Set(tokens)];

    const message = {
      tokens: uniqueTokens,
      notification: { title, body },
      android: {
        priority: 'high',
      }
    };

    if (imageUrl) {
      message.notification.imageUrl = imageUrl;
      message.android.notification = { imageUrl: imageUrl };
      message.apns = {
        payload: { aps: { 'mutable-content': 1 } },
        fcm_options: { image: imageUrl }
      };
    }

    console.log(`🔔 Sending reminder: "${title}" to ${uniqueTokens.length} devices.`);
    console.log('Tokens:', uniqueTokens);

    const response = await messaging.sendEachForMulticast(message);
    
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
