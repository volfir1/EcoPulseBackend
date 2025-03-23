// controllers/accountController.js
const User = require('../models/User');
const generateTokens = require('../utils/token');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { sendReactivationConfirmationEmail, sendAdminNotification, sendReactivationTokenEmail } = require('../utils/emailService');
const { getFrontendURL } = require('../utils/helper');



/**
 * Deactivate a user account (soft delete)
 * @route POST /api/auth/deactivate-account
 */
exports.deactivateAccount = async (req, res) => {
  try {
    // Get the user ID from the authenticated user
    const userId = req.user.id;
    console.log(`Processing account deactivation request for user: ${userId}`);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if already deactivated
    if (user.isDeactivated || user.isAutoDeactivated) {
      return res.status(400).json({
        success: false,
        message: "Account is already deactivated"
      });
    }

    // Generate a reactivation token (valid for 90 days)
    const reactivationToken = crypto.randomBytes(32).toString("hex");
    const reactivationTokenExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

    // Update user to deactivated status
    user.isDeactivated = true;
    user.deletedAt = new Date();
    user.reactivationToken = reactivationToken;
    user.reactivationTokenExpires = reactivationTokenExpires;
    
    await user.save();

    // Send reactivation email
    try {
      await sendReactivationTokenEmail(user, reactivationToken);
      console.log(`Reactivation token email sent to ${user.email}`);
    } catch (emailError) {
      console.error("Error sending reactivation email:", emailError);
      // Continue even if email fails
    }

    // Notify admins
    try {
      await sendAdminNotification(user, 'account_deactivated');
      console.log('Admin notification sent about account deactivation');
    } catch (notifyError) {
      console.error("Admin notification error:", notifyError);
      // Continue even if notification fails
    }

    // Clear auth cookies
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
    
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    res.status(200).json({
      success: true,
      message: "Account deactivated successfully. A reactivation link has been sent to your email."
    });
  } catch (error) {
    console.error("Account deactivation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/**
 * Reactivate an auto-deactivated account using a token
 * @route POST /api/auth/reactivate-account
 */
exports.reactivateAccount = async (req, res) => {
  try {
    // Get token from query params or body
    const token = req.query.token || req.body.token;
    const cleanToken = token ? token.trim() : null;

    console.log('Processing account reactivation request with token:', 
      cleanToken ? `${cleanToken.substring(0, 5)}...` : 'missing');

    if (!cleanToken) {
      return res.status(400).json({
        success: false,
        message: "Reactivation token is required",
        redirectUrl: `${getFrontendURL()}/reactivate-account?error=missing_token`
      });
    }

    // Use direct MongoDB query to bypass the middleware and include deleted users
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const rawUser = await usersCollection.findOne({ reactivationToken: cleanToken });
    
    // Log detailed information about the query and result
    console.log('Reactivation token search details:', {
      token: cleanToken.substring(0, 5) + '...',
      userFound: !!rawUser,
      userId: rawUser ? rawUser._id.toString() : null,
      email: rawUser ? rawUser.email : null,
      isDeactivated: rawUser ? !!rawUser.isDeactivated : null,
      isAutoDeactivated: rawUser ? !!rawUser.isAutoDeactivated : null
    });
    
    if (!rawUser) {
      console.log('No user found with reactivation token');
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reactivation token",
        redirectUrl: `${getFrontendURL()}/reactivate-account?error=invalid_token`
      });
    }

    // Check if token is expired
    if (rawUser.reactivationTokenExpires && new Date(rawUser.reactivationTokenExpires) < new Date()) {
      console.log('Reactivation token has expired');
      return res.status(400).json({
        success: false,
        message: "Reactivation token has expired",
        redirectUrl: `${getFrontendURL()}/reactivate-account?error=expired_token&userId=${rawUser._id}`
      });
    }

    console.log('Reactivating user account...');
    
    // Update directly in MongoDB instead of using Mongoose model
    const updateResult = await usersCollection.updateOne(
      { _id: rawUser._id },
      { 
        $set: { 
          isDeactivated: false,
          isAutoDeactivated: false,
          lastActivity: new Date(),
          lastLogin: new Date()
        },
        $unset: {
          deletedAt: "",
          autoDeactivatedAt: "",
          reactivationToken: "",
          reactivationTokenExpires: "",
          lastReactivationAttempt: "",
          reactivationAttempts: ""
        }
      }
    );

    console.log('User update result:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      userId: rawUser._id.toString(),
      email: rawUser.email
    });

    // Verify the update was successful
    if (updateResult.matchedCount === 0) {
      throw new Error("Failed to update user record");
    }

    // Get the updated user document
    const updatedUser = await usersCollection.findOne({ _id: rawUser._id });
    
    // Send confirmation email
    try {
      // Create a user object for the email service
      const userForEmail = {
        _id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName || '',
        lastName: updatedUser.lastName || ''
      };
      
      await sendReactivationConfirmationEmail(userForEmail);
      console.log('Reactivation confirmation email sent');
    } catch (emailError) {
      console.error("Error sending reactivation confirmation email:", emailError);
      // Continue even if email fails
    }

    // Notify admins about the reactivation
    try {
      const userForEmail = {
        _id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName || '',
        lastName: updatedUser.lastName || ''
      };
      
      await sendAdminNotification(userForEmail, 'account_reactivated');
      console.log('Admin notification sent');
    } catch (notifyError) {
      console.error("Admin notification error:", notifyError);
      // Continue even if notification fails
    }

    // Convert updated document to Mongoose model for token generation
    const User = mongoose.model('User');
    const userModel = new User(updatedUser);
    
    // Generate authentication tokens - pass isNew: false to avoid Mongoose thinking it's a new document
    userModel.isNew = false;
    const { accessToken, refreshToken } = generateTokens(userModel, res);

    // After successful reactivation
    res.status(200).json({
      success: true,
      message: "Account reactivated successfully",
      redirectUrl: `${getFrontendURL()}/login?status=reactivated&email=${encodeURIComponent(updatedUser.email)}`,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        gender: updatedUser.gender,
        avatar: updatedUser.avatar,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        lastLogin: new Date(),
        accessToken
      }
    });

  } catch (error) {
    console.error("Account reactivation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during account reactivation",
      error: error.message,
      redirectUrl: `${getFrontendURL()}/reactivate-account?error=server_error`
    });
  }
};


/**
 * Check account status - use this to see if an account is deactivated
 * @route POST /api/auth/check-account-status
 */
exports.checkAccountStatus = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Use a direct MongoDB query to get user regardless of active status
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ email: email });
    
    if (!user) {
      return res.status(200).json({
        success: true,
        exists: false,
        message: "No account found with this email"
      });
    }

    // Check account status
    if (user.isAutoDeactivated) {
      // Generate a new reactivation token if needed
      let reactivationToken = user.reactivationToken;
      let tokenExpired = false;
      
      // Check if token is expired or doesn't exist
      if (!reactivationToken || 
          !user.reactivationTokenExpires || 
          new Date(user.reactivationTokenExpires) < new Date()) {
        
        // Token is expired, note this but don't generate a new one yet
        tokenExpired = true;
      }

      return res.status(200).json({
        success: true,
        exists: true,
        isActive: false,
        isAutoDeactivated: true,
        deactivatedAt: user.autoDeactivatedAt,
        tokenExpired: tokenExpired,
        message: "This account has been deactivated due to inactivity."
      });
    }

    // Account exists and is active
    return res.status(200).json({
      success: true,
      exists: true,
      isActive: !user.isDeactivated,
      message: user.isDeactivated ? "This account has been manually deleted." : "Account is active."
    });
  } catch (error) {
    console.error("Check account status error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

/**
 * Request a new reactivation token for an auto-deactivated account
 * @route POST /api/auth/request-reactivation
 */
// exports.requestReactivation = async (req, res) => {
//   try {
//     const { email } = req.body;

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         message: "Email is required"
//       });
//     }

//     // Find the auto-deactivated user directly from MongoDB
//     const db = mongoose.connection.db;
//     const usersCollection = db.collection('users');
//     const user = await usersCollection.findOne({ 
//       email: email,
//       isAutoDeactivated: true 
//     });
    
//     // For security, don't reveal if user exists or not
//     if (!user) {
//       return res.status(200).json({
//         success: true,
//         message: "If your account exists and is deactivated, a reactivation email will be sent."
//       });
//     }

//     // Generate a new reactivation token
//     const reactivationToken = crypto.randomBytes(32).toString("hex");
    
//     // Update user with new token
//     await usersCollection.updateOne(
//       { _id: user._id },
//       { 
//         $set: {
//           reactivationToken: reactivationToken,
//           reactivationTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
//           lastReactivationAttempt: new Date(),
//           reactivationAttempts: (user.reactivationAttempts || 0) + 1
//         }
//       }
//     );

//     // Create a user object for the email service
//     const userForEmail = {
//       _id: user._id,
//       email: user.email,
//       firstName: user.firstName || 'User',
//       lastName: user.lastName || ''
//     };

//     // Send reactivation email
//     const emailService = require('../utils/emailService');
//     try {
//       await emailService.sendReactivationConfirmationEmail(userForEmail, reactivationToken);
//       console.log(`Reactivation email sent to ${email}`);
//     } catch (emailError) {
//       console.error("Error sending reactivation email:", emailError);
//       // Continue even if email fails
//     }

//     res.status(200).json({
//       success: true,
//       message: "If your account exists and is deactivated, a reactivation email has been sent."
//     });
//   } catch (error) {
//     console.error("Reactivation request error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message
//     });
//   }
// };

/**
 * Debug function to get information about auto-deactivated accounts
 * @route GET /api/auth/debug/deactivated-accounts
 */
exports.debugAutoDeactivatedAccounts = async (req, res) => {
  try {
    // Get all auto-deactivated users
    const users = await User.find({
      isAutoDeactivated: true
    }).select('email firstName lastName isAutoDeactivated autoDeactivatedAt reactivationToken reactivationTokenExpires lastReactivationAttempt');
    
    // Format user data for display
    const formattedUsers = users.map(user => ({
      id: user._id.toString(),
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      deactivatedAt: user.autoDeactivatedAt,
      hasReactivationToken: Boolean(user.reactivationToken),
      tokenFirstChars: user.reactivationToken ? user.reactivationToken.substring(0, 10) : null,
      tokenLength: user.reactivationToken ? user.reactivationToken.length : 0,
      tokenExpires: user.reactivationTokenExpires,
      isExpired: user.reactivationTokenExpires ? user.reactivationTokenExpires < new Date() : null,
      lastReactivationAttempt: user.lastReactivationAttempt
    }));
    
    res.json({
      success: true,
      count: formattedUsers.length,
      users: formattedUsers
    });
  } catch (error) {
    console.error('Debug auto-deactivated accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

/**
 * Debug email service configuration
 * @route GET /api/auth/debug/email-service
 */
exports.debugEmailService = async (req, res) => {
  try {
    console.log('Checking email service configuration...');
    
    // Try to import the email service directly
    let emailServiceModule;
    try {
      emailServiceModule = require('../utils/emailService');
      console.log('Email service module imported successfully');
    } catch (err) {
      console.error('Failed to import email service:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to import email service module',
        error: err.message
      });
    }
    
    // Check if the required functions exist
    const serviceInfo = {
      sendVerificationEmail: typeof emailServiceModule.sendVerificationEmail === 'function',
      sendGoogleVerificationEmail: typeof emailServiceModule.sendGoogleVerificationEmail === 'function',
      sendPasswordResetEmail: typeof emailServiceModule.sendPasswordResetEmail === 'function',
      sendAutoDeactivationEmail: typeof emailServiceModule.sendAutoDeactivationEmail === 'function',
      sendReactivationConfirmationEmail: typeof emailServiceModule.sendReactivationConfirmationEmail === 'function',
      sendAdminNotification: typeof emailServiceModule.sendAdminNotification === 'function',
      serviceStructure: Object.keys(emailServiceModule)
    };
    
    // Look at the email service configuration
    let emailConfig = null;
    try {
      emailConfig = {
        host: process.env.EMAIL_HOST || 'Not configured',
        port: process.env.EMAIL_PORT || 'Not configured',
        secure: process.env.EMAIL_SECURE === 'true',
        hasUsername: !!process.env.EMAIL_USER,
        hasPassword: !!process.env.EMAIL_PASS
      };
    } catch (configErr) {
      console.error('Error accessing email configuration:', configErr);
    }
    
    return res.json({
      success: true,
      emailService: serviceInfo,
      emailConfig: emailConfig
    });
  } catch (error) {
    console.error('Email service debug error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


exports.adminDeactivateUser = async (req, res) => {
  try {
    // Check if requesting user is an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action"
      });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Find the user to deactivate
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if already deactivated
    if (user.isDeactivated || user.isAutoDeactivated) {
      return res.status(400).json({
        success: false,
        message: "Account is already deactivated"
      });
    }

    // Generate a reactivation token (valid for 90 days)
    const reactivationToken = crypto.randomBytes(32).toString("hex");
    const reactivationTokenExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

    // Update user to deactivated status
    user.isDeactivated = true;
    user.deletedAt = new Date();
    user.deactivatedBy = req.user.id; // Record who deactivated the account
    user.reactivationToken = reactivationToken;
    user.reactivationTokenExpires = reactivationTokenExpires;
    
    await user.save();

    // Send reactivation email
    try {
      await sendReactivationTokenEmail(user, reactivationToken);
      console.log(`Admin action: Reactivation token email sent to ${user.email}`);
    } catch (emailError) {
      console.error("Error sending reactivation email:", emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: "User account deactivated successfully. A reactivation link has been sent to their email."
    });
  } catch (error) {
    console.error("Admin account deactivation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


/**
 * Request a reactivation token for a deactivated account
 * @route POST /api/auth/request-reactivation
 */
exports.requestReactivation = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Find the deactivated user directly from MongoDB to bypass any middleware filters
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ 
      email: email,
      $or: [
        { isDeactivated: true },
        { isAutoDeactivated: true }
      ]
    });
    
    // For security, don't reveal if user exists or not
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If your account exists and is deactivated, a reactivation email will be sent."
      });
    }

    // Generate a new reactivation token
    const reactivationToken = crypto.randomBytes(32).toString("hex");
    
    // Update user with new token
    await usersCollection.updateOne(
      { _id: user._id },
      { 
        $set: {
          reactivationToken: reactivationToken,
          reactivationTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
          lastReactivationAttempt: new Date(),
          reactivationAttempts: (user.reactivationAttempts || 0) + 1
        }
      }
    );

    // Create a user object for the email service
    const userForEmail = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName || 'User',
      lastName: user.lastName || ''
    };

    // Send reactivation email
    try {
      await sendReactivationTokenEmail(userForEmail, reactivationToken);
      console.log(`Reactivation token email sent to ${email}`);
    } catch (emailError) {
      console.error("Error sending reactivation email:", emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: "If your account exists and is deactivated, a reactivation email has been sent."
    });
  } catch (error) {
    console.error("Reactivation request error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

exports.checkDeactivatedAccount = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // For security, we always return success even if the account doesn't exist
    // This prevents email enumeration
    const defaultResponse = {
      success: true,
      isDeactivated: false
    };

    // Use a direct MongoDB query to get user regardless of active status
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.status(200).json(defaultResponse);
    }

    // Check if account is deactivated
    if (user.isDeactivated || user.isAutoDeactivated) {
      // Check if there's a reactivation token and if it's expired
      let tokenExpired = false;
      if (user.reactivationTokenExpires && new Date(user.reactivationTokenExpires) < new Date()) {
        tokenExpired = true;
      }

      return res.status(200).json({
        success: true,
        isDeactivated: true,
        tokenExpired,
        lockoutRemaining: tokenExpired ? 0 : Math.floor((new Date(user.reactivationTokenExpires) - new Date()) / (1000 * 60 * 60 * 24)) // Days remaining
      });
    }

    // Account exists but is not deactivated
    return res.status(200).json(defaultResponse);
  } catch (error) {
    console.error("Check deactivated account error:", error);
    return res.status(200).json({
      success: true,
      isDeactivated: false
    }); // Always return the same response for security
  }
};

/**
 * Check account status
 * @route POST /api/auth/check-account-status
 */
exports.checkAccountStatus = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Use a direct MongoDB query to get user regardless of active status
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return res.status(200).json({
        success: true,
        exists: false,
        message: "No account found with this email"
      });
    }

    // Check account status
    if (user.isDeactivated || user.isAutoDeactivated) {
      // Check if there's a reactivation token and if it's expired
      let tokenExpired = false;
      if (!user.reactivationToken || 
          !user.reactivationTokenExpires || 
          new Date(user.reactivationTokenExpires) < new Date()) {
        tokenExpired = true;
      }

      return res.status(200).json({
        success: true,
        exists: true,
        isActive: false,
        isDeactivated: !!user.isDeactivated,
        isAutoDeactivated: !!user.isAutoDeactivated,
        deactivatedAt: user.deletedAt || user.autoDeactivatedAt,
        tokenExpired,
        message: user.isAutoDeactivated 
          ? "This account has been deactivated due to inactivity." 
          : "This account has been deactivated."
      });
    }

    // Account exists and is active
    return res.status(200).json({
      success: true,
      exists: true,
      isActive: true,
      message: "Account is active."
    });
  } catch (error) {
    console.error("Check account status error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};