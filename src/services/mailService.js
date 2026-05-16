const nodemailer = require('nodemailer');
const C = require('../config/constants');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Port 587 uses STARTTLS
  auth: {
    user: C.EMAIL_USER,
    pass: C.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false // Helps in some restricted environments
  },
  connectionTimeout: 15000,
});

const sendOTP = async (email, otp) => {
  const mailOptions = {
    from: `"Attendify Support" <${C.EMAIL_USER}>`,
    to: email,
    subject: 'Password Reset OTP - Attendify',
    html: `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0d0d0d; padding: 40px 20px; text-align: center;">
        <div style="max-width: 450px; margin: 0 auto; background-color: #161616; padding: 40px 30px; border-radius: 24px; border: 1px solid #262626; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
          
          <div style="margin-bottom: 30px;">
            <div style="display: inline-block; padding: 12px; background-color: rgba(0, 229, 190, 0.1); border-radius: 16px;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 15V17M12 7V11M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="#00E5BE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>

          <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Reset Your Password</h2>
          <p style="color: #8896B3; font-size: 15px; line-height: 1.5; margin-bottom: 32px;">Use the verification code below to securely reset your account password.</p>
          
          <div style="background: linear-gradient(135deg, rgba(0, 229, 190, 0.1) 0%, rgba(0, 184, 148, 0.05) 100%); padding: 24px; border-radius: 20px; border: 1px dashed rgba(0, 229, 190, 0.3); margin-bottom: 32px;">
            <div style="font-family: 'Monaco', 'Consolas', monospace; font-size: 32px; font-weight: 800; color: #00E5BE; letter-spacing: 6px; display: block;">
              ${otp}
            </div>
          </div>
          
          <div style="padding: 16px; background-color: #1e1e1e; border-radius: 12px; margin-bottom: 32px;">
            <p style="color: #F59E0B; font-size: 13px; font-weight: 600; margin: 0;">⚠️ This code expires in 10 minutes</p>
          </div>

          <p style="color: #4A5568; font-size: 12px; margin-bottom: 0;">If you didn't request this code, please ignore this email.</p>
          
          <div style="margin-top: 40px; border-top: 1px solid #262626; padding-top: 20px;">
            <p style="color: #4A5568; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 0;">Attendify Systems</p>
          </div>
        </div>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${email}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Email send failed:', error);
    // Even if email fails, we don't throw to prevent API crash, 
    // but the user won't get the code.
    return false;
  }
};

module.exports = { sendOTP };
