module.exports = {
  OFFICE_START: '09:30',
  OFFICE_END: '18:30',
  GRACE_TIME: '09:45',
  APPRECIATION_CHECKOUT_MIN: '19:30', // 7:30 PM
  LUNCH_BREAK_HOURS: 1,
  NET_WORKING_HOURS: 9,
  LATE_WARNING_DAYS: 2,

  LATE_DEDUCTION_FROM_DAY: 3,
  EARNED_LEAVES_PER_MONTH: 1,

  ROLES: { ADMIN: 'admin', EMPLOYEE: 'employee' },

  STATUS: {
    PRESENT: 'present', ABSENT: 'absent', LATE: 'late',
    HALF_DAY: 'half_day', LEAVE: 'leave', SUNDAY: 'sunday',
  },

  LEAVE_TYPES: {
    EARNED: 'earned', UNPAID: 'unpaid',
    HALF_DAY: 'half_day', PERMISSION_HOURS: 'permission_hours',
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
};
