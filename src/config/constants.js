module.exports = {
  OFFICE_START: '09:30',
  OFFICE_END: '18:30',
  GRACE_TIME: '10:10',
  APPRECIATION_CHECKOUT_MIN: '19:30', // 7:30 PM
  LUNCH_BREAK_HOURS: 1,
  NET_WORKING_HOURS: 9,
  LATE_WARNING_DAYS: 3,

  LATE_DEDUCTION_FROM_DAY: 4,
  EARNED_LEAVES_PER_MONTH: 1,
  APPRECIATION_CHECKIN_MAX: '10:10',

  OFFICE_LAT: 9.932548064389838,
  OFFICE_LNG: 78.14469758285455,
  MAX_DISTANCE_METERS: 100,
  GEOFENCE_THRESHOLD_METERS: 300,

  ROLES: { ADMIN: 'admin', EMPLOYEE: 'employee' },

  STATUS: {
    PRESENT: 'present', ABSENT: 'absent', LATE: 'late',
    HALF_DAY: 'half_day', LEAVE: 'leave', SUNDAY: 'sunday',
  },

  LEAVE_TYPES: {
    EARNED: 'earned', UNPAID: 'unpaid', CASUAL: 'casual',
    HALF_DAY: 'half_day', PERMISSION_HOURS: 'permission_hours',
    CLIENT_MEETING: 'client_meeting', EMPLOYEE_SUPPORT: 'employee_support',
  },

  LEAVE_STATUS: {
    PENDING: 'pending', APPROVED: 'approved',
    REJECTED: 'rejected', CANCELLED: 'cancelled',
  },

  USER_STATUS: {
    PENDING: 'pending', ACTIVE: 'active',
    INACTIVE: 'inactive', REJECTED: 'rejected',
  },

  TIMEZONE: 'Asia/Kolkata',

  // Leave Policies
  SICK_LEAVES_PER_YEAR: 12,
  CASUAL_LEAVES_PER_MONTH: 1,
  FREE_PERMISSION_MIN_PER_MONTH: 60, // 1 hour free permission

  // Email Config (Brevo API - Professional Delivery)
  BREVO_API_KEY: process.env.BREVO_API_KEY || 'xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  EMAIL_SENDER: 'bharathv1004@gmail.com',
};
 