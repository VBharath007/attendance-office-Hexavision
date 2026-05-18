const { admin, db, messaging } = require('../config/firebase');
const moment = require('moment-timezone');
const C = require('../config/constants');
/**
 * Sends push notifications to all employees with active sessions.
 * @param {string} title 
 * @param {string} body 
 * @param {string} imageUrl 
 * @param {Object} extraData - Optional data payload
 */
const sendReminders = async (title, body, imageUrl = null, extraData = {}) => {
  try {
    const today = moment().tz(C.TIMEZONE).format('YYYY-MM-DD');
    const isSunday = moment().tz(C.TIMEZONE).day() === 0;

    // Skip on Sundays
    if (isSunday) {
      console.log('ℹ️ Today is Sunday, skipping reminders.');
      return { success: true, message: 'Skipped for Sunday' };
    }

    // Get today's attendance
    const attSnap = await db.collection('attendance').where('date', '==', today).get();
    const attendanceMap = {};
    attSnap.forEach(doc => {
      attendanceMap[doc.data().employee_id] = doc.data();
    });

    // Get today's leaves
    const leavesSnap = await db.collection('leaves').where('status', '==', 'approved').get();
    const onLeaveIds = new Set();
    leavesSnap.forEach(doc => {
      const l = doc.data();
      if (l.from_date <= today && (l.to_date || l.from_date) >= today) {
        onLeaveIds.add(l.employee_id);
      }
    });

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
      
      // Filter out users on leave
      if (onLeaveIds.has(data.uid)) return;

      // Filter based on reminder type and attendance state
      if (extraData.type === 'wakeup' || extraData.type === 'check-in') {
        if (attendanceMap[data.uid] && attendanceMap[data.uid].check_in) {
          return; // Skip if already checked in
        }
      } else if (extraData.type === 'check-out') {
        if (attendanceMap[data.uid] && attendanceMap[data.uid].check_out) {
          return; // Skip if already checked out
        }
      } else if (extraData.type === 'overtime') {
        const att = attendanceMap[data.uid];
        if (!att || !att.check_in || att.check_out) {
          return; // Skip if they haven't checked in or have already checked out
        }
      }

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

    // 3. Fetch names from both employees and admins collections
    const uidToName = {};
    const chunkSize = 30;
    
    for (let i = 0; i < uids.length; i += chunkSize) {
      const chunk = uids.slice(i, i + chunkSize);
      
      // Fetch from employees using document IDs for better reliability
      const empsSnap = await db.collection('employees')
        .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
        .get();
      
      empsSnap.forEach(doc => {
        const data = doc.data();
        let firstName = 'Member';
        if (data.full_name) {
          firstName = data.full_name.trim().split(' ')[0];
          // Capitalize first letter
          firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
        }
        uidToName[doc.id] = firstName;
      });

      // Fetch from admins (for those not found in employees)
      const remainingUids = chunk.filter(id => !uidToName[id]);
      if (remainingUids.length > 0) {
        const adminsSnap = await db.collection('admins')
          .where(admin.firestore.FieldPath.documentId(), 'in', remainingUids)
          .get();
        
        adminsSnap.forEach(doc => {
          const data = doc.data();
          let firstName = 'Admin';
          if (data.full_name) {
            firstName = data.full_name.trim().split(' ')[0];
            firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
          }
          uidToName[doc.id] = firstName;
        });
      }
    }

    // 4. Build individual personalized messages
    const messages = [];
    for (const token of uniqueTokens) {
      const uid = tokenToLatestSession[token].uid;
      const name = uidToName[uid] || 'Team Member';
      
      // Personalize the body: "Hi Name, [lowercase first letter of original message]"
      let formattedBody = body;
      if (body && body.length > 0) {
        formattedBody = body.charAt(0).toLowerCase() + body.slice(1);
      }
      const personalizedBody = `Hi ${name}, ${formattedBody}`;
      
      const msg = {
        token: token,
        notification: { 
          title: title, 
          body: personalizedBody 
        },
        data: { ...extraData, title: title, body: personalizedBody, name: name },
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

/**
 * Sends a notification to all admins.
 * @param {string} title 
 * @param {string} body 
 * @param {Object} data - Optional data payload
 */
const notifyAdmins = async (title, body, data = {}) => {
  try {
    // 1. Get all admins who have an fcm_token
    const adminsSnap = await db.collection('admins')
      .where('fcm_token', '!=', null)
      .get();

    // 2. Also check active admin sessions just in case the fcm_token hasn't been synced to the admin doc yet
    const activeSessionsSnap = await db.collection('sessions')
      .where('is_active', '==', true)
      .get();

    const tokens = new Set();
    adminsSnap.forEach(doc => {
      const d = doc.data();
      if (d.fcm_token) tokens.add(d.fcm_token);
    });

    // Cross-check sessions for admin UIDs
    const adminUids = new Set(adminsSnap.docs.map(doc => doc.id));
    activeSessionsSnap.forEach(doc => {
      const d = doc.data();
      if (adminUids.has(d.uid) && d.fcm_token) {
        tokens.add(d.fcm_token);
      }
    });

    if (tokens.size === 0) {
      console.log('ℹ️ No admin FCM tokens found.');
      return { success: true, message: 'No admin tokens' };
    }

    const messages = Array.from(tokens).map(token => ({
      token: token,
      notification: { title, body },
      data: { ...data, type: 'admin_notification' },
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
          }
        }
      }
    }));

    console.log(`🔔 Notifying ${messages.length} admins: ${title}`);
    const response = await messaging.sendEach(messages);
    return { success: true, sentCount: response.successCount };

  } catch (error) {
    console.error('❌ Error in notifyAdmins:', error);
    return { success: false, error: error.message };
  }
};

module.exports = { sendReminders, notifyAdmins };
