// backend/utils/emailService.js - COMPLETE CODE

const nodemailer = require('nodemailer');
// Assuming your User model is correctly located relative to this file
const User = require('../models/User');
// Load environment variables. Should ideally happen once at app start,
// but included here for module safety.
require('dotenv').config();

// --- Configuration Validation ---

const REQUIRED_ENV_VARS = [
  'EMAIL_SERVICE',          // e.g., 'gmail'
  'EMAIL_USER',             // Sending email address (e.g., ecopulse00@gmail.com)
  'EMAIL_APP_PASSWORD',     // App-specific password for EMAIL_USER
  'FRONTEND_URL',           // Base URL of your frontend (e.g., http://localhost:5173 or https://ecopulse-alpha.vercel.app)
  'EMAIL_FROM',             // Display address in 'From' field (e.g., noreply@ecopulse.com or "EcoPulse <noreply@ecopulse.com>")
];

// Optional ENV VARS used: BACKUP_EMAIL_*, LOGO_URL, ADMIN_EMAIL

function checkEnvironmentConfig() {
  const missingVars = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
  if (missingVars.length > 0) {
    const message = `FATAL: Email Service configuration error: Missing required environment variables: ${missingVars.join(', ')}`;
    console.error(message);
    // Throwing here will prevent the app from starting if config is bad
    throw new Error(message);
  }
  console.log("Email Service: Required environment variables are present.");
}

// Run config check immediately when the module loads
checkEnvironmentConfig();

// --- Transporter Setup ---

/** Creates a nodemailer transporter based on env vars with an optional prefix */
function createTransporter(prefix = '') {
  const service = process.env[`${prefix}EMAIL_SERVICE`];
  const host = process.env[`${prefix}EMAIL_HOST`];
  const port = process.env[`${prefix}EMAIL_PORT`];
  const user = process.env[`${prefix}EMAIL_USER`];
  // Check for both APP_PASSWORD and regular PASSWORD for flexibility
  const pass = process.env[`${prefix}EMAIL_APP_PASSWORD`] || process.env[`${prefix}EMAIL_PASSWORD`];
  const secure = process.env[`${prefix}EMAIL_SECURE`] === 'true'; // Explicit check for 'true'

  // Cannot create transporter without credentials
  if (!user || !pass) {
    if (prefix === '') console.warn("Primary email credentials missing.");
    else console.log(`No credentials found for ${prefix} transporter.`);
    return null;
  }

  const options = {
    // Prefer explicit host/port if provided, otherwise use service
    ...(service && !host && { service }),
    ...(host && { host }),
    ...(port && { port: parseInt(port, 10) }), // Ensure port is integer
    secure: !!secure, // Ensure boolean (defaults to false if port != 465)
    auth: { user, pass },
    // Avoid `tls: { rejectUnauthorized: false }` in production unless absolutely necessary
    // Only include it if required by your specific provider/setup.
    ...(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'false' && { tls: { rejectUnauthorized: false } })
  };

  console.log(`Creating ${prefix || 'primary'} transporter (Host: ${options.host || options.service || 'N/A'}, Port: ${options.port || 'Default'})`);
  try {
     return nodemailer.createTransport(options);
  } catch(transportError) {
      console.error(`Failed to create ${prefix || 'primary'} transporter:`, transportError);
      return null;
  }
}

// Initialize Transporters
const primaryTransporter = createTransporter();
const backupTransporter = createTransporter('BACKUP_');

// Define lastResortTransporter only if primary exists (uses its credentials)
const lastResortTransporter = primaryTransporter ? nodemailer.createTransport({
    host: 'smtp.gmail.com', // Specific fallback to Gmail SMTP
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    ...(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === 'false' && { tls: { rejectUnauthorized: false } }) // Reuse TLS setting if specified
}) : null;

// Filter out null transporters
const availableTransporters = [primaryTransporter, backupTransporter, lastResortTransporter].filter(t => t !== null);

if (availableTransporters.length === 0) {
  const message = "FATAL: No email transporters could be configured. Check primary EMAIL_* and potentially BACKUP_EMAIL_* env vars.";
  console.error(message);
  throw new Error(message); // Prevent app start without working email
}

// Verify transporters asynchronously after setup
availableTransporters.forEach((transporterInstance, index) => {
  const name = index === 0 ? 'Primary' : index === 1 ? 'Backup' : 'Last Resort';
  transporterInstance.verify()
    .then(() => console.log(`Email Service: ${name} transporter verified successfully.`))
    .catch(error => {
         console.error(`Email Service: ${name} transporter verification FAILED.`);
         console.error(` -> Error Code: ${error.code}, Command: ${error.command}`);
         console.error(` -> Config Used (masked):`, {
             ...(transporterInstance.options.host && { host: transporterInstance.options.host }),
             ...(transporterInstance.options.service && { service: transporterInstance.options.service }),
             ...(transporterInstance.options.port && { port: transporterInstance.options.port }),
             secure: transporterInstance.options.secure,
             auth: { user: transporterInstance.options.auth?.user || 'N/A', pass: '******' },
             tls: transporterInstance.options.tls
         });
    });
});


// --- Helper Functions ---

/** Generates a 6-digit verification code */
const generateVerificationCode = () => Math.floor(100000 + Math.random() * 900000).toString();

/** Creates a frontend web URL with encoded token */
const getWebUrl = (path, token) => {
    // Ensures trailing slash on base URL and leading slash on path are handled
    const baseUrl = process.env.FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
    const formattedPath = path.startsWith('/') ? path : `/${path}`; // Add leading slash if missing
    return `${baseUrl}${formattedPath}?token=${encodeURIComponent(token)}`;
};

/** Creates a mobile app deep link URL with encoded token */
const getAppSchemeUrl = (path, token) => {
    const formattedPath = path.startsWith('/') ? path.substring(1) : path; // Remove leading slash for scheme path
    return `ecopulse://${formattedPath}?token=${encodeURIComponent(token)}`;
};

/** Helper to store verification/reactivation codes in the User document */
const storeCodeInDb = async (userId, code, fieldName, expiryHours) => {
  if (!userId || !code || !fieldName || !expiryHours) {
    console.error("storeCodeInDb Error: Missing required parameters.");
    return false;
  }
  try {
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    // Ensure the field name exists in your User schema!
    const updateResult = await User.findByIdAndUpdate(userId, {
      [fieldName]: code,
      [`${fieldName}Expires`]: expiresAt
    }, { new: false }); // new: false can be slightly faster if you don't need the updated doc back

    if (!updateResult) {
        console.error(`storeCodeInDb Error: User not found with ID: ${userId}`);
        return false;
    }

    console.log(`Stored ${fieldName} code ${code.substring(0,3)}... for user ${userId}`); // Log partial code
    return true;
  } catch (error) {
    console.error(`Error storing ${fieldName} code for user ${userId}:`, error);
    return false; // Indicate failure but don't necessarily stop email sending
  }
};

/** Interprets common SMTP errors for more user-friendly messages */
const interpretSmtpError = (error) => {
  let userMessage = 'Failed to send email. Please try again later or contact support.';
  if (!error) return userMessage; // Handle cases where error might be null/undefined

  const errorCode = String(error.code || '').toUpperCase(); // Standardize case
  const responseCode = error.responseCode;
  const command = String(error.command || '').toUpperCase();

  if (errorCode === 'EAUTH' || command === 'AUTH LOGIN' || responseCode === 535) {
    userMessage = 'Email service authentication failed. Please contact support.';
    console.error('CRITICAL: Email authentication failure - check credentials.');
  } else if (['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'ENOTFOUND'].includes(errorCode)) {
    userMessage = 'Could not connect to the email service. Please check network or configuration.';
    console.error('CRITICAL: Email connection/network failure.');
  } else if ([550, 551, 552, 553, 554].includes(responseCode)) { // Common rejection codes
    userMessage = 'Email address rejected by the server. Please ensure it is valid.';
    console.error('Email rejected by server - possibly invalid recipient.');
  } else if (error.message?.includes('Missing credentials') || error.message?.includes('No transport method defined')) {
     userMessage = 'Email service is not configured correctly. Please contact support.';
     console.error('CRITICAL: Email configuration error detected during send.', error.message);
  } else if (errorCode === 'EMESSAGE') { // Generic message error from Nodemailer
      userMessage = 'There was an issue formatting the email message.';
      console.error('Email formatting/content error.', error.message);
  }
  // Add more specific checks based on observed errors

  return userMessage;
};

/** Tries sending email using available transporters in order (Primary > Backup > LastResort) */
const _sendMailWithFallback = async (mailOptions) => {
  let lastError = null;
  for (let i = 0; i < availableTransporters.length; i++) {
    const transporterInstance = availableTransporters[i];
    const transporterName = ['Primary', 'Backup', 'Last Resort'][i];
    try {
      console.log(`Attempting to send email via ${transporterName} transporter to ${mailOptions.to}...`);
      const info = await transporterInstance.sendMail(mailOptions);
      console.log(`Email sent successfully via ${transporterName} (ID: ${info.messageId})`);
      return { success: true, messageId: info.messageId, provider: transporterInstance.options?.auth?.user || 'unknown' };
    } catch (error) {
      lastError = error; // Store the error
      console.error(`Failed sending email via ${transporterName}: ${error.message} (Code: ${error.code}, Command: ${error.command})`);
    }
  }

  // If loop finishes without returning success
  console.error("All available email transporters failed.");
  if(lastError) {
    console.error(" -> Last Error:", lastError.message);
    console.error(" -> Stack Trace:", lastError.stack); // Log stack for the final error
  }
  const userFriendlyMessage = interpretSmtpError(lastError || new Error('Unknown email sending failure'));
  // Throwing here means the calling function's catch block will handle it
  throw new Error(userFriendlyMessage);
};


// --- HTML Template Helpers ---

/** Builds standard reusable email header */
const _buildEmailHeader = (title = 'EcoPulse Notification') => `
  <div style="text-align: center; margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-bottom: 1px solid #eee;">
    ${process.env.LOGO_URL ?
      `<img src="${process.env.LOGO_URL}" alt="EcoPulse Logo" style="max-height: 60px; max-width: 180px; margin-bottom: 10px;">` :
      `<h1 style="color: #2C7A51; margin: 0; font-size: 24px;">${title}</h1>`}
  </div>`;

/** Builds standard reusable email footer */
const _buildEmailFooter = () => `
  <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee; text-align: center; font-size: 0.85em; color: #6c757d;">
    <p>If you need help, please contact our support team or visit our website.</p>
    <p>© ${new Date().getFullYear()} EcoPulse. All rights reserved.</p>
  </div>`;

/** Generates HTML template for verification code emails */
const getEmailTemplate = (verificationCode, isGoogleSignIn = false) => {
  const themeColor = '#2C7A51';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; line-height: 1.6;">
      ${_buildEmailHeader(isGoogleSignIn ? 'Complete Google Sign-In' : 'Verify Your Email')}
      <h2 style="color: ${themeColor}; text-align: center;">Welcome to EcoPulse!</h2>
      <p>Hello,</p>
      <p>${
        isGoogleSignIn
          ? "You're almost there! To complete your Google sign-in"
          : "Thank you for registering. To complete your registration"
      }, please use the verification code below:</p>

      <div style="background-color: #f4f4f4; padding: 15px 20px; border-radius: 5px; text-align: center; font-size: 26px; letter-spacing: 6px; margin: 25px 0; font-weight: bold; font-family: monospace; color: #333;">
        ${verificationCode}
      </div>

      <p>This verification code is valid for 2 hours.</p>
      <p>If you did not ${
        isGoogleSignIn ? 'attempt to sign in with Google' : 'create an account'
      }, please disregard this email. Your account remains secure.</p>
      ${_buildEmailFooter()}
    </div>
  `;
};

/** Builds HTML for password reset email (Web Link Only version) */
function buildPasswordResetHtml(user, shortCode, webResetUrl, appSchemeUrl, isMobile) {
   return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; line-height: 1.6;">
      ${_buildEmailHeader('Password Reset Request')}
      <h2 style="color: #4CAF50; text-align: center;">Password Reset Request</h2>
      <p>Hello ${user.firstName || user.name || 'there'},</p>
      <p>We received a password reset request. Please use the link below within 1 hour to set a new password:</p>

      <!-- Web Link Option -->
      <div style="margin: 25px 0; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fafafa;">
          <h3 style="margin-top:0; color: #333;">Reset via Web Browser</h3>
          <p style="color: #555;">Click the button below or copy the full link into your browser.</p>
           <div style="text-align: center; margin: 25px 0;">
            <a href="${webResetUrl}" style="background-color: #4CAF50; color: white !important; padding: 12px 25px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password Now</a>
          </div>
          <p style="font-size: 0.85em; word-break: break-all; color: #777;">Link: <a href="${webResetUrl}" style="color: #4CAF50;">${webResetUrl}</a></p>
      </div>

      <!-- Security Note -->
      <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
          If you did not request this password reset, you can safely ignore this email. Your password will not be changed.
      </p>
      ${_buildEmailFooter()}
    </div>
    `;
}

/** Builds HTML for reactivation email (auto or requested) */
function buildReactivationHtml(user, verificationCode, reactivationUrl, appSchemeUrl, introductoryText, expiryDays) {
  // Re-added the mobile app code section here as it seems useful for reactivation
  return `
     <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; line-height: 1.6;">
       ${_buildEmailHeader('Reactivate Your Account')}
       <h2 style="color: #2C7A51; text-align: center;">Account Reactivation</h2>
       <p>Hello ${user.firstName || user.name || 'there'},</p>
       <p>${introductoryText} Please use one of the options below:</p>

       <!-- Option 1: Web Link -->
       <div style="margin: 25px 0; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fafafa;">
           <h3 style="margin-top:0; color: #333;">Option 1: Reactivate on the Web</h3>
           <p style="color: #555;">Click the button below or copy the link into your browser.</p>
           <div style="text-align: center; margin: 25px 0;">
               <a href="${reactivationUrl}" style="background-color: #2C7A51; color: white !important; padding: 12px 25px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block;">Reactivate Account (Web)</a>
           </div>
           <p style="font-size: 0.85em; word-break: break-all; color: #777;">Link: <a href="${reactivationUrl}" style="color: #2C7A51;">${reactivationUrl}</a></p>
       </div>

       <!-- Option 2: App Code -->
       <div style="margin: 25px 0; padding: 20px; border: 1px solid #eee; border-radius: 8px; background-color: #fafafa;">
           <h3 style="margin-top:0; color: #333;">Option 2: Use Code in Mobile App</h3>
           <p style="color: #555;">Enter this code in the EcoPulse mobile app when prompted:</p>
           <div style="background-color: #e8f5e9; border: 1px dashed #a5d6a7; border-radius: 5px; padding: 15px; margin: 20px 0;">
             <code style="display: block; font-family: monospace; font-size: 26px; letter-spacing: 6px; font-weight: bold; text-align: center; color: #1b5e20;">${verificationCode}</code>
           </div>
            <div style="text-align: center; margin: 20px 0;">
               <a href="${appSchemeUrl}" style="background-color: #5c6bc0; color: white !important; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Open App to Reactivate</a>
           </div>
       </div>

       <!-- Footer Info -->
       <div style="margin-top: 30px; color: #666; font-size: 0.9em;">
         <p>This reactivation link and code will expire in ${expiryDays} days.</p>
         <p>If you wish to keep your account deactivated, please ignore this email.</p>
       </div>
       ${_buildEmailFooter()}
     </div>`;
}


/** Builds the HTML for the admin alert email for deactivated login attempts */
function buildDeactivatedLoginAlertHtml(user, eventTime) {
 return `
      <!DOCTYPE html>
      <html lang="en">
      <head> <meta charset="UTF-8"> <meta name="viewport" content="width=device-width, initial-scale=1.0"> <title>Account Alert</title> </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333333; background-color: #f5f5f5;">
         <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
           <!-- Header -->
           <div style="background-color: #dc3545; padding: 20px; text-align: center;">
             <h1 style="color: white; margin: 0; font-size: 24px;">EcoPulse Security Alert</h1>
           </div>
           <!-- Content -->
           <div style="padding: 30px; line-height: 1.6;">
             <p style="font-size: 16px; margin-top: 0;">A login attempt with the correct password was detected for a <strong>deactivated account</strong>:</p>
             <div style="background-color: #f9f9f9; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; font-size: 14px;">
               <h2 style="margin-top: 0; color: #dc3545; font-size: 18px;">Event Details</h2>
               <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                 <tr><td style="padding: 6px 0; font-weight: bold; width: 30%;">User:</td><td style="padding: 6px 0;">${user.firstName || ''} ${user.lastName || ''}</td></tr>
                 <tr><td style="padding: 6px 0; font-weight: bold;">Email:</td><td style="padding: 6px 0;"><a href="mailto:${user.email}" style="color: #007bff; text-decoration: none;">${user.email}</a></td></tr>
                 <tr><td style="padding: 6px 0; font-weight: bold;">User ID:</td><td style="padding: 6px 0; font-family: monospace;">${user._id}</td></tr>
                 <tr><td style="padding: 6px 0; font-weight: bold;">Timestamp:</td><td style="padding: 6px 0;">${eventTime}</td></tr>
               </table>
             </div>
             <p style="font-size: 16px;">A reactivation link/code has been automatically sent to the user's email address.</p>
             <div style="background-color: #fffbeb; border-left: 4px solid #fbbf24; padding: 15px; margin: 20px 0;">
               <p style="margin: 0; font-weight: bold; color: #92400e;">Action Recommended:</p>
               <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px;">No immediate action required unless this pattern is suspicious or repeats frequently. Monitor if necessary.</p>
             </div>
           </div>
           <!-- Footer -->
           <div style="padding: 20px; background-color: #f5f5f5; text-align: center; font-size: 14px; color: #666666; border-top: 1px solid #dddddd;">
             <p style="margin: 0;">This is an automated message from the EcoPulse Monitoring System.</p>
             <p style="margin: 10px 0 0 0;">© ${new Date().getFullYear()} EcoPulse. All rights reserved.</p>
           </div>
         </div>
      </body>
      </html>`;
}

// --- Email Sending Function Definitions ---

/** Sends the standard account verification code email */
const sendVerificationEmail = async (user) => {
  if (!user?._id || !user?.email) { // Robust check for user object properties
    console.error("sendVerificationEmail Error: Invalid user object provided.");
    throw new Error("Invalid user object provided for verification email.");
  }
  console.log(`Preparing verification email for ${user.email}`);
  try {
    const verificationCode = generateVerificationCode();
    // Store the code; proceed even if storage fails, but log it
    const stored = await storeCodeInDb(user._id, verificationCode, 'verificationCode', 2); // 2 hours expiry
     if(!stored) { console.warn(`Failed to store verificationCode in DB for user ${user._id}`); }

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Verify Your Account - EcoPulse',
      html: getEmailTemplate(verificationCode, false)
    };

    // Use primary transporter ONLY for basic verification emails usually
    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Verification email sent successfully (Primary) to ${user.email} (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error(`Detailed verification email error for ${user.email}:`, error);
    // The thrown error will be interpreted by the _sendMailWithFallback caller or caught here
    // interpretSmtpError provides a user-friendly message
    throw new Error(`Failed to send verification email: ${interpretSmtpError(error)}`);
  }
};

/** Sends verification code for Google Sign-in completion */
const sendGoogleVerificationEmail = async (user) => {
   if (!user?._id || !user?.email) {
     console.error("sendGoogleVerificationEmail Error: Invalid user object provided.");
     throw new Error("Invalid user object provided for Google verification email.");
   }
   console.log(`Preparing Google verification email for ${user.email}`);
   try {
     const verificationCode = generateVerificationCode();
     const stored = await storeCodeInDb(user._id, verificationCode, 'verificationCode', 2); // 2 hours expiry
     if(!stored) { console.warn(`Failed to store verificationCode for Google flow for user ${user._id}`); }

     const mailOptions = {
       from: process.env.EMAIL_FROM,
       to: user.email,
       subject: 'Complete Your Google Sign-in - EcoPulse',
       html: getEmailTemplate(verificationCode, true)
     };

     const info = await primaryTransporter.sendMail(mailOptions);
     console.log(`Google verification email sent successfully (Primary) to ${user.email} (ID: ${info.messageId})`);
     return { success: true, messageId: info.messageId };
   } catch (error) {
     console.error(`Error sending Google verification email for ${user.email}:`, error);
     throw new Error(`Failed to send Google verification email: ${interpretSmtpError(error)}`);
   }
};

/** Sends password reset instructions (link only) with fallback */
const sendPasswordResetEmail = async (user, fullToken, shortCode, platform = 'unknown') => {
  // Note: shortCode and platform are technically unused with the current template, but kept for signature stability
  if (!user?._id || !user?.email || !fullToken) {
     console.error("sendPasswordResetEmail Error: Missing user, email, or token.");
     throw new Error("Missing required parameters for password reset email.");
  }
   console.log(`Preparing password reset email for ${user.email}`);
  try {
    // Generate URLs
    const webResetUrl = getWebUrl('/reset-password', fullToken);
    // App scheme URL is generated but not used in this HTML version
    const appSchemeUrl = getAppSchemeUrl('reset-password', fullToken);
    const isMobile = ['android', 'ios'].includes(platform.toLowerCase());

    // Build HTML using the template that omits the mobile code section
    const html = buildPasswordResetHtml(user, shortCode, webResetUrl, appSchemeUrl, isMobile);

    const mailOptions = {
      from: `EcoPulse Support <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Password Reset Instructions - EcoPulse',
      html: html,
      text: `Visit this link to reset your password: ${webResetUrl}` // Simple text fallback
    };

    // Send using the fallback mechanism
    const result = await _sendMailWithFallback(mailOptions);
    return result; // Returns { success: true, messageId: ..., provider: ... }

  } catch (error) {
    // The error from _sendMailWithFallback is already user-friendly
    console.error(`Password reset email failed for ${user.email}:`, error);
    throw error; // Re-throw the interpreted error
  }
};

/** Sends auto-deactivation notice (link + code) */
const sendAutoDeactivationEmail = async (user, reactivationToken) => {
  if (!user?._id || !user?.email || !reactivationToken) {
    console.error("sendAutoDeactivationEmail Error: Missing user, email, or token.");
    throw new Error("Missing required parameters for auto-deactivation email.");
  }
  console.log(`Preparing auto-deactivation email for ${user.email}`);
  try {
    const verificationCode = generateVerificationCode();
    // Use longer expiry for reactivation code
    const stored = await storeCodeInDb(user._id, verificationCode, 'reactivationCode', 90 * 24); // 90 days expiry for code
    if(!stored) { console.warn(`Failed to store reactivationCode for user ${user._id}`); }

    const reactivationUrl = getWebUrl('/reactivate-account', reactivationToken);
    const appSchemeUrl = getAppSchemeUrl('reactivate-account', reactivationToken);

    // Use the reactivation HTML builder
    const html = buildReactivationHtml(user, verificationCode, reactivationUrl, appSchemeUrl, "Your EcoPulse account has been automatically deactivated due to inactivity.", 90);

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Your EcoPulse Account Has Been Deactivated',
      html: html
    };

    // Use primary transporter
    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Auto-deactivation email sent successfully (Primary) to ${user.email} (ID: ${info.messageId})`);
    // Return code mainly for testing, not strictly needed by caller
    return { success: true, messageId: info.messageId, verificationCode };

  } catch (error) {
    console.error(`Error sending auto-deactivation email for ${user.email}:`, error);
    throw new Error(`Failed to send auto-deactivation email: ${interpretSmtpError(error)}`);
  }
};

/** Sends reactivation confirmation email */
const sendReactivationConfirmationEmail = async (user) => {
  if (!user?.email) {
     console.error("sendReactivationConfirmationEmail Error: Invalid user object.");
     throw new Error("Invalid user object for reactivation confirmation.");
  }
   console.log(`Preparing reactivation confirmation email for ${user.email}`);
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; line-height: 1.6;">
        ${_buildEmailHeader('Account Reactivated')}
        <h2 style="color: #2C7A51; text-align: center;">Account Reactivated!</h2>
        <p>Hello ${user.firstName || user.name || 'there'},</p>
        <p>Welcome back! Your EcoPulse account has been successfully reactivated.</p>
        <p>You now have full access to all features and services again.</p>
        <p>If you did not reactivate your account or have concerns, please contact our support team immediately.</p>
        ${_buildEmailFooter()}
      </div>`;

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Account Reactivated - EcoPulse',
      html: html
    };

    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Reactivation confirmation email sent successfully (Primary) to ${user.email} (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error(`Error sending reactivation confirmation email for ${user.email}:`, error);
    throw new Error(`Failed to send reactivation confirmation email: ${interpretSmtpError(error)}`);
  }
};

/** Sends notification to admin about account reactivation */
const sendAdminNotification = async (user) => {
  if (!user?._id || !user?.email) {
     console.error("sendAdminNotification Error: Invalid user object.");
     // Don't throw, just log and return failure as it's non-critical to user flow
     return { success: false, error: "Invalid user object provided for admin notification." };
  }
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER; // Target admin or fallback
  if (!adminEmail) {
       console.error("sendAdminNotification Error: No ADMIN_EMAIL or fallback EMAIL_USER configured.");
       return { success: false, error: "Admin email recipient not configured." };
  }

  console.log(`Preparing admin notification email for ${user.email} reactivation to ${adminEmail}`);
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; padding: 15px; border: 1px solid #ccc;">
         ${_buildEmailHeader('Account Reactivation Notification')}
         <p>A previously deactivated account has been reactivated:</p>
         <ul style="background-color: #f9f9f9; padding: 10px; border-radius: 4px;">
           <li><strong>User:</strong> ${user.firstName || 'N/A'} ${user.lastName || 'N/A'}</li>
           <li><strong>Email:</strong> ${user.email}</li>
           <li><strong>User ID:</strong> ${user._id}</li>
           <li><strong>Reactivated at:</strong> ${new Date().toISOString()}</li>
         </ul>
         <p><strong>EcoPulse Admin System</strong></p>
      </div>`;

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: adminEmail, // Send to configured admin address
      subject: 'FYI: Account Reactivated - EcoPulse',
      html: html
    };

    // Use primary transporter; if this fails, it's logged but doesn't stop user flow
    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Admin notification sent successfully (Primary) to ${adminEmail} (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error(`Error sending admin notification to ${adminEmail}: ${error.message}`);
    // Log interpreted error for clarity but return generic failure for the caller
    console.error(` -> Interpreted: ${interpretSmtpError(error)}`);
    return { success: false, error: "Failed to send admin notification email." };
  }
};

/** Sends email containing reactivation link/code when user explicitly requests it */
const sendReactivationTokenEmail = async (user, reactivationToken) => {
  if (!user?._id || !user?.email || !reactivationToken) {
    console.error("sendReactivationTokenEmail Error: Missing user, email, or token.");
    throw new Error("Missing required parameters for reactivation token email.");
  }
  console.log(`Preparing requested reactivation email for ${user.email}`);
  try {
    const verificationCode = generateVerificationCode();
    // Use longer expiry for reactivation code
    const stored = await storeCodeInDb(user._id, verificationCode, 'reactivationCode', 90 * 24); // 90 days expiry
    if(!stored) { console.warn(`Failed to store requested reactivationCode for user ${user._id}`); }

    const reactivationUrl = getWebUrl('/reactivate-account', reactivationToken);
    const appSchemeUrl = getAppSchemeUrl('reactivate-account', reactivationToken);

    // Use the reactivation HTML builder
    const html = buildReactivationHtml(user, verificationCode, reactivationUrl, appSchemeUrl, "You requested to reactivate your EcoPulse account. Please use one of the options below:", 90);

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: 'Reactivate Your EcoPulse Account',
      html: html
    };

    // Send using primary transporter
    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Reactivation token email sent successfully (Primary) to ${user.email} (ID: ${info.messageId})`);
    // Return code for potential testing or alternative flows
    return { success: true, messageId: info.messageId, verificationCode };

  } catch (error) {
    console.error(`Error sending requested reactivation token email for ${user.email}:`, error);
    throw new Error(`Failed to send reactivation token email: ${interpretSmtpError(error)}`);
  }
};

/** Sends alert to admins about login attempt on a deactivated account */
const sendDeactivatedLoginAttempt = async (user) => {
   if (!user?._id || !user?.email) {
     console.error("sendDeactivatedLoginAttempt Error: Invalid user object.");
     return { success: false, error: "Invalid user object provided for deactivated login alert." };
   }

  // Find Admin Emails
  const staticAdminEmails = ['ecopulse00@gmail.com']; // Hardcoded fallback/primary admins
  let adminEmails = [...staticAdminEmails];
  try {
    // Attempt to find dynamic admins from DB
    const adminUsers = await User.find({
      role: { $in: ['admin', 'superadmin'] }, // Allow different admin roles
      isVerified: true,
      isDeactivated: { $ne: true }, // Ensure admin isn't deactivated
      isAutoDeactivated: { $ne: true }
     }).select('email').lean(); // .lean() for performance if just getting email

    if (adminUsers?.length > 0) {
      adminUsers.forEach(admin => {
        if (admin.email && !adminEmails.includes(admin.email)) {
          adminEmails.push(admin.email);
        }
      });
    }
    adminEmails = [...new Set(adminEmails)]; // Deduplicate
    console.log('Found dynamic admin emails for alert:', adminEmails.filter(e => !staticAdminEmails.includes(e)));
  } catch (dbError) {
    console.error('Error querying for admin users for alert, using static list only:', dbError);
  }

  if (adminEmails.length === 0) {
      console.error("CRITICAL: No admin emails configured or found for deactivated login attempt alert.");
      return { success: false, error: "No admin recipients configured for this alert." };
  }

  console.log(`Preparing deactivated login alert for user ${user.email} to admins: ${adminEmails.join(', ')}`);
  try {
    const eventTime = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'long' }); // Example format
    const html = buildDeactivatedLoginAlertHtml(user, eventTime); // Use template helper

    const mailOptions = {
      // Use a specific sender for alerts if desired, fallback to default EMAIL_FROM
      from: process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM,
      to: adminEmails.join(','), // Send to all collected admins
      subject: 'SECURITY ALERT: Deactivated Account Login Attempt - EcoPulse',
      html: html
    };

    // Send alert using primary transporter
    const info = await primaryTransporter.sendMail(mailOptions);
    console.log(`Deactivated login alert sent successfully (Primary) to ${adminEmails.join(', ')} (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error(`Error sending deactivated login alert email: ${error.message}`);
    // Log interpreted error
    console.error(` -> Interpreted: ${interpretSmtpError(error)}`);
    // Attempt minimal fallback to static admins
    try {
       await primaryTransporter.sendMail({
         from: process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM,
         to: staticAdminEmails.join(','), // Fallback to only static list
         subject: '⚠️ ALERT SYSTEM FAILURE - Deactivated Login',
         text: `Failed to send full alert email. Deactivated login attempt detected for user: ${user?.email || 'Unknown User'} at ${new Date().toISOString()}`
       });
       console.warn("Sent minimal fallback alert to static admins due to primary alert failure.");
       return { success: false, error: "Failed to send full alert, minimal fallback attempted." };
    } catch(fallbackErr){
       console.error("CRITICAL: Fallback alert also failed:", fallbackErr);
       return { success: false, error: "Failed to send primary and fallback alerts." };
    }
  }
};


// --- Exports ---
// Export all functions intended for use by other backend modules (e.g., controllers)
module.exports = {
  sendVerificationEmail,
  sendGoogleVerificationEmail,
  sendPasswordResetEmail,
  sendAutoDeactivationEmail,
  sendReactivationConfirmationEmail,
  sendAdminNotification,
  sendReactivationTokenEmail,
  sendDeactivatedLoginAttempt
  // Do not typically export helper functions unless needed externally
};