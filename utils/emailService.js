// utils/emailService.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure nodemailer transport
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Existing function for verification emails
const getEmailTemplate = (verificationCode, isGoogleSignIn = false) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2C7A51;">Welcome to EcoPulse!</h2>
      <p>${
        isGoogleSignIn
          ? "You're almost there! To complete your Google sign-in"
          : "Thank you for registering. To complete your registration"
      }, please use the verification code below:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0;">
        <strong>${verificationCode}</strong>
      </div>
      
      <p>This verification code will expire in 2 hours.</p>
      
      <p>If you did not ${
        isGoogleSignIn ? 'attempt to sign in with Google' : 'create an account'
      }, you can safely ignore this email.</p>
      
      <p>Thank you,<br>The EcoPulse Team</p>
    </div>
  `;
};

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// New function to generate the HTML template for password reset email
const getResetEmailTemplate = (resetUrl) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2C7A51;">Reset Your Password</h2>
      <p>We received a request to reset your password. Please click the link below to choose a new password:</p>
      
      <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 18px; margin: 20px 0;">
        <a href="${resetUrl}" style="color: #2C7A51; text-decoration: none;">Reset Password</a>
      </div>
      
      <p>This link will expire in 1 hour. If you didn't request a password reset, please ignore this email.</p>
      
      <p>Thank you,<br>The EcoPulse Team</p>
    </div>
  `;
};

// Existing functions for sending verification emails
const sendVerificationEmail = async (user) => {
  try {
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const expirationTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

    // Check if user is a Mongoose model instance or a plain object
    if (typeof user.save === 'function') {
      // It's a Mongoose model, use save() method
      user.verificationCode = verificationCode;
      user.verificationCodeExpires = expirationTime;
      await user.save();
    } else {
      // It's a plain object, use User model to update
      const User = require('../models/User');
      await User.findByIdAndUpdate(user._id, {
        verificationCode: verificationCode,
        verificationCodeExpires: expirationTime
      });
    }

    console.log('Attempting to send verification email...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Verify Your Account - EcoPulse',
      html: getEmailTemplate(verificationCode, false)
    });

    console.log('Email sent successfully:', {
      messageId: info.messageId,
      recipient: user.email
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Detailed email error:', {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

const sendGoogleVerificationEmail = async (user) => {
  try {
    const verificationCode = generateVerificationCode();
    const expirationTime = new Date(Date.now() + 2 * 60 * 60 * 1000);

    user.verificationCode = verificationCode;
    user.verificationCodeExpires = expirationTime;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Complete Your Google Sign-in - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Welcome to EcoPulse!</h2>
          <p>You're almost there! To complete your Google sign-in, please use the verification code below:</p>
          
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0;">
            <strong>${verificationCode}</strong>
          </div>
          
          <p>This verification code will expire in 2 hours.</p>
          
          <p>If you did not attempt to sign in with Google, you can safely ignore this email.</p>
          
          <p>Thank you,<br>The EcoPulse Team</p>
        </div>
      `
    });

    console.log(`Google verification email sent to ${user.email}`);
    return { success: true };
  } catch (error) {
    console.error('Error sending Google verification email:', error);
    throw error;
  }
};

// New function for sending password reset email
const sendPasswordResetEmail = async (user, fullToken, shortCode, platform = 'unknown') => {
  try {
    // Validate configuration
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }

    // Generate links - still use the full token in links
    const webBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const webResetUrl = `${webBaseUrl}/reset-password?token=${fullToken}`;
    const appSchemeUrl = `ecopulse://reset-password?token=${fullToken}`;
    const universalLink = process.env.UNIVERSAL_LINK_DOMAIN 
      ? `https://${process.env.UNIVERSAL_LINK_DOMAIN}/reset-password?token=${fullToken}`
      : webResetUrl;

    // Platform detection
    const isMobile = ['android', 'ios'].includes(platform.toLowerCase());
    
    // Email template
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <!-- Header -->
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="${process.env.LOGO_URL}" alt="Company Logo" style="max-width: 150px;">
      </div>

      <!-- Main Content -->
      <h2 style="color: #4CAF50; text-align: center;">Password Reset Request</h2>
      <p>Hello ${user.name || 'there'},</p>
      <p>We received a password reset request. Use the button below within 1 hour:</p>

      <!-- Reset Button -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="${isMobile ? appSchemeUrl : webResetUrl}" 
           style="background-color: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Reset Password
        </a>
      </div>

      <!-- Token Section - Now showing the short code -->
      <div style="background-color: #f5f5f5; border-radius: 4px; padding: 15px;">
        <p style="margin-bottom: 15px;">Or enter this verification code in the app:</p>
        
        <!-- Copy Container -->
        <div style="display: flex; gap: 10px; align-items: center; background-color: white; border: 1px solid #ddd; border-radius: 4px; padding: 15px; text-align: center;">
          <code style="flex-grow: 1; font-family: monospace; font-size: 24px; letter-spacing: 4px; font-weight: bold; text-align: center;">${shortCode}</code>
        </div>

        <!-- Fallback Instructions -->
        <p style="font-size: 0.9em; color: #666; margin-top: 15px;">
          Enter this code in the app when prompted to reset your password.
        </p>
      </div>

      <!-- Footer -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
        <p style="color: #666; font-size: 0.9em;">
          Not expecting this email? You can safely ignore it.
        </p>
      </div>
    </div>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: `EcoPulse Support <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Password Reset Instructions',
      html: html,
      text: `Please use this code to reset your password: ${shortCode}\nOr use this link: ${isMobile ? appSchemeUrl : webResetUrl}`
    });

    console.log(`Password reset email sent to ${user.email}`, {
      messageId: info.messageId,
      platform,
      shortCode, // Log the short code for debugging
      deliveryTime: new Date().toISOString()
    });

    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('Password reset email failure:', {
      error: error.message,
      user: user.email,
      timestamp: new Date().toISOString()
    });
    throw new Error('Failed to send password reset email. Please try again later.');
  }
};
// Account recovery email
const sendAccountRecoveryEmail = async (user, token) => {
  try {
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }
    
    // Use environment variable for the frontend URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const recoveryUrl = `${baseUrl}/reactivate-account?token=${token}`;

    console.log('Sending account recovery email...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Recover Your Account - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Account Recovery</h2>
          <p>We received a request to recover your deactivated account. Click the link below to reactivate your account:</p>
          
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <a href="${recoveryUrl}" style="background-color: #2C7A51; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Recover My Account</a>
          </div>
          
          <p><strong>Important:</strong> This link will expire in 5 hours.</p>
          <p>If you did not request to recover your account, please ignore this email.</p>
          
          <p>Thank you,<br>The EcoPulse Team</p>
        </div>
      `
    });

    console.log('Account recovery email sent successfully:', {
      messageId: info.messageId,
      recipient: user.email
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending account recovery email:', error);
    throw new Error(`Failed to send account recovery email: ${error.message}`);
  }
};

// For auto-deactivation emails
const sendAutoDeactivationEmail = async (user, reactivationToken) => {
  try {
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }
    
    // Use environment variable for the frontend URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    // Use the reactivationToken parameter correctly
    const reactivationUrl = `${baseUrl}/reactivate-account?token=${reactivationToken}`;

    console.log('Sending auto-deactivation email...');
    console.log('Reactivation URL:', reactivationUrl);
    
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Your Account Has Been Deactivated - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Account Deactivated</h2>
          <p>Your EcoPulse account has been automatically deactivated due to inactivity.</p>
          <p>To reactivate your account, please click the link below:</p>
          
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <a href="${reactivationUrl}" style="background-color: #2C7A51; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Reactivate My Account</a>
          </div>
          
          <p>This link will expire in 90 days.</p>
          <p>If you no longer wish to use your account, no action is needed.</p>
          
          <p>Thank you,<br>The EcoPulse Team</p>
        </div>
      `
    });

    console.log('Auto-deactivation email sent successfully:', {
      messageId: info.messageId,
      recipient: user.email
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending auto-deactivation email:', error);
    throw new Error(`Failed to send auto-deactivation email: ${error.message}`);
  }
};

// For reactivation confirmation emails
const sendReactivationConfirmationEmail = async (user) => {
  try {
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }

    console.log('Sending reactivation confirmation email...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Account Reactivated - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Account Reactivated</h2>
          <p>Your EcoPulse account has been successfully reactivated.</p>
          <p>You now have full access to all features and services again.</p>
          <p>If you did not reactivate your account, please contact our support team immediately.</p>
          
          <p>Thank you,<br>The EcoPulse Team</p>
        </div>
      `
    });

    console.log('Reactivation confirmation email sent successfully:', {
      messageId: info.messageId,
      recipient: user.email
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending reactivation confirmation email:', error);
    throw new Error(`Failed to send reactivation confirmation email: ${error.message}`);
  }
};

// For admin notifications
const sendAdminNotification = async (user) => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }

    console.log('Sending admin notification...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: adminEmail,
      subject: 'Account Reactivation Notification - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Account Reactivation Notification</h2>
          <p>A previously deactivated account has been reactivated:</p>
          <ul>
            <li><strong>User:</strong> ${user.firstName} ${user.lastName}</li>
            <li><strong>Email:</strong> ${user.email}</li>
            <li><strong>User ID:</strong> ${user._id}</li>
            <li><strong>Reactivated at:</strong> ${new Date().toISOString()}</li>
          </ul>
          
          <p>EcoPulse Admin System</p>
        </div>
      `
    });

    console.log('Admin notification sent successfully:', {
      messageId: info.messageId
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending admin notification:', error);
    throw new Error(`Failed to send admin notification: ${error.message}`);
  }
};

const sendReactivationTokenEmail = async (user, reactivationToken) => {
  try {
    if (!process.env.EMAIL_FROM || !process.env.EMAIL_USER) {
      throw new Error('Email configuration is missing');
    }
    
    // Use environment variable for the frontend URL
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const reactivationUrl = `${baseUrl}/reactivate-account?token=${reactivationToken}`;

    console.log('Sending reactivation token email...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Reactivate Your Account - EcoPulse',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C7A51;">Reactivate Your Account</h2>
          <p>Your EcoPulse account has been deactivated. To reactivate your account, please click the link below:</p>
          
          <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
            <a href="${reactivationUrl}" style="background-color: #2C7A51; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Reactivate My Account</a>
          </div>
          
          <p>This link will expire in 90 days.</p>
          <p>If you did not request account reactivation or wish to keep your account deactivated, no action is needed.</p>
          
          <p>Thank you,<br>The EcoPulse Team</p>
        </div>
      `
    });

    console.log('Reactivation token email sent successfully:', {
      messageId: info.messageId,
      recipient: user.email
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending reactivation token email:', error);
    throw new Error(`Failed to send reactivation token email: ${error.message}`);
  }
};
const sendDeactivatedLoginAttempt = async (user) => {
  try {
    console.log('Starting admin notification for deactivated account login:', user.email);
    
    // Define admin emails directly first - guaranteed delivery
    const staticAdminEmails = ['ecopulse00@gmail.com']; // Add your admin emails here
    let adminEmails = [...staticAdminEmails];
    
    // Then try to find dynamic admin emails from database
    try {
      const User = require('../models/User');
      console.log('Querying for admin users in the database...');
      
      // More detailed logging of what we're looking for
      console.log('Query criteria:', { 
        role: 'admin', 
        isVerified: true,
        isDeactivated: false,
        isAutoDeactivated: false
      });
      
      const adminUsers = await User.find({ 
        role: 'admin',
        isVerified: true,
        isDeactivated: false,
        isAutoDeactivated: false
      }).select('email firstName lastName');
      
      console.log('Admin query results:', {
        found: adminUsers.length,
        adminEmails: adminUsers.map(u => u.email)
      });
      
      // Add any found admin emails to our list
      if (adminUsers && adminUsers.length > 0) {
        adminUsers.forEach(admin => {
          if (admin.email && !adminEmails.includes(admin.email)) {
            adminEmails.push(admin.email);
          }
        });
      }
    } catch (dbError) {
      console.error('Error querying for admin users:', dbError);
      // Continue with static admins even if DB query fails
    }
    
    // Ensure we have unique emails
    adminEmails = [...new Set(adminEmails)];
    
    console.log(`Sending deactivated account login notification to ${adminEmails.length} admin(s):`, adminEmails);
    
    // Format the date and time in a more readable format
    const eventTime = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });

    // Complete email template with user details
    const emailTemplate = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Alert</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333333; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background-color: #2C7A51; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">EcoPulse Security Alert</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 30px;">
            <p style="font-size: 16px; line-height: 1.5; margin-top: 0;">A login attempt was detected for a deactivated account in the EcoPulse system.</p>
            
            <div style="background-color: #f9f9f9; border-left: 4px solid #2C7A51; padding: 15px; margin: 20px 0;">
              <h2 style="margin-top: 0; color: #2C7A51; font-size: 18px;">Event Details</h2>
              <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; width: 40%;">User:</td>
                  <td style="padding: 8px 0;">${user.firstName} ${user.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Email:</td>
                  <td style="padding: 8px 0;"><a href="mailto:${user.email}" style="color: #2C7A51; text-decoration: none;">${user.email}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">User ID:</td>
                  <td style="padding: 8px 0; font-family: monospace;">${user._id}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
                  <td style="padding: 8px 0;">${eventTime}</td>
                </tr>
              </table>
            </div>
            
            <p style="font-size: 16px; line-height: 1.5;">This user's password was entered correctly, but their account has been deactivated. A reactivation link has been sent to the user's email.</p>
            
            <div style="background-color: #fffbeb; border-left: 4px solid #fbbf24; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold; color: #92400e;">Action Required:</p>
              <p style="margin-top: 8px; margin-bottom: 0;">If this activity appears suspicious, please review the account and consider taking appropriate security measures.</p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="padding: 20px; background-color: #f5f5f5; text-align: center; font-size: 14px; color: #666666; border-top: 1px solid #dddddd;">
            <p style="margin: 0;">This is an automated message from the EcoPulse System.</p>
            <p style="margin: 10px 0 0 0;">© ${new Date().getFullYear()} EcoPulse. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'ecopulse00@gmail.com',
      to: adminEmails.join(','),
      subject: '🔔 EcoPulse Security Alert: Deactivated Account Login',
      html: emailTemplate
    });

    console.log('Admin notification email sent successfully:', {
      messageId: info.messageId,
      recipients: adminEmails
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending admin notification email:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    
    // Try a direct emergency fallback
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'ecopulse00@gmail.com',
        to: 'ecopulse00@gmail.com',
        subject: '⚠️ URGENT: Deactivation Alert (Fallback)',
        html: `<p>Fallback alert: ${user.email} login attempt on deactivated account</p>`
      });
    } catch (fallbackError) {
      console.error('Even fallback email failed:', fallbackError);
    }
    
    throw new Error(`Failed to send admin notification email: ${error.message}`);
  }
};


// Verify that the email server is ready
transporter.verify(function(error, success) {
  if (error) {
    console.error('Email transport verification failed:', error);
  } else {
    console.log('Email server is ready to send messages');
  }
});

// Export all the necessary functions
module.exports = {
  generateVerificationCode,
  sendVerificationEmail,
  sendGoogleVerificationEmail,
  sendPasswordResetEmail,
  sendAccountRecoveryEmail,
  sendAutoDeactivationEmail,
  sendReactivationConfirmationEmail,
  sendAdminNotification,
  sendDeactivatedLoginAttempt,
  sendReactivationTokenEmail  
};