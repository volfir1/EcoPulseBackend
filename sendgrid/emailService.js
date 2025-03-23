// utils/emailService.js
const nodemailer = require('nodemailer');

// Create a transporter using Gmail or another SMTP provider
const transporter = nodemailer.createTransport({
  service: 'gmail',  // or 'outlook', etc.
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD // Use app password for Gmail
  }
});

const sendEmail = async (to, subject, message) => {
  try {
    await transporter.sendMail({
      from: `"Support Team" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: message,
      html: `<div>${message}</div>`,
    });
    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Email sending failed:', error);
    return false;
  }
};

module.exports = sendEmail;