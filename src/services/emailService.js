const nodemailer = require('nodemailer');
const functions = require('firebase-functions');

const getTransporter = () => nodemailer.createTransport({
  host: functions.config().email?.host || process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: 587, secure: false,
  auth: {
    user: functions.config().email?.user || process.env.EMAIL_USER,
    pass: functions.config().email?.pass || process.env.EMAIL_PASS,
  },
});

const FROM = () => functions.config().email?.from || process.env.EMAIL_FROM || 'AttendanceApp <noreply@company.com>';

const sendEmail = async ({ to, subject, html }) => {
  await getTransporter().sendMail({ from: FROM(), to, subject, html });
};

const sendApprovalEmail = async (employee) => sendEmail({
  to: employee.email, subject: '✅ Account Approved',
  html: `<p>Dear <b>${employee.full_name}</b>, your account is approved! Login with Employee ID: <b>${employee.employee_id}</b></p>`,
});

const sendRejectionEmail = async (employee, reason) => sendEmail({
  to: employee.email, subject: 'Registration Update',
  html: `<p>Dear <b>${employee.full_name}</b>, your registration could not be approved.${reason ? ` Reason: ${reason}` : ''}</p>`,
});

const sendOTPEmail = async (email, otp, name) => sendEmail({
  to: email, subject: '🔐 Password Reset OTP',
  html: `<p>Dear <b>${name}</b>, your OTP is: <b style="font-size:24px;letter-spacing:4px">${otp}</b>. Valid for 10 minutes.</p>`,
});

const sendLeaveStatusEmail = async (employee, leave, status, remarks) => sendEmail({
  to: employee.email,
  subject: `Leave ${status === 'approved' ? 'Approved ✅' : 'Rejected ❌'}`,
  html: `<p>Dear <b>${employee.full_name}</b>, your ${leave.leave_type} leave has been <b>${status}</b>.${remarks ? ` Remarks: ${remarks}` : ''}</p>`,
});

const sendAdminRegistrationAlert = async (adminEmail, employee) => sendEmail({
  to: adminEmail, subject: `🆕 New Registration: ${employee.full_name}`,
  html: `<p>New registration from <b>${employee.full_name}</b> (ID: ${employee.employee_id}). Please review in admin panel.</p>`,
});

module.exports = { sendEmail, sendApprovalEmail, sendRejectionEmail, sendOTPEmail, sendLeaveStatusEmail, sendAdminRegistrationAlert };
