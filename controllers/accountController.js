// controllers/accountController.js
const User = require('../models/User');
const generateTokens = require('../utils/token');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { sendReactivationConfirmationEmail, sendAdminNotification, sendReactivationTokenEmail } = require('../utils/emailService');
const { getFrontendURL } = require('../utils/helper');



//Deactivate a user account (soft delete)
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

//Reactivate an auto-deactivated account using a token
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

// Check account status - use this to see if an account is deactivated
exports.checkAccountStatus = async (req, res) => {
  const { email } = req.body;

  // 1. Input Validation
  if (!email) {
      return res.status(400).json({
          success: false,
          message: "Email is required",
      });
  }

  try {
      // 2. Database Query
      const db = mongoose.connection.db;
      const usersCollection = db.collection('users');

      // Find user and project only necessary fields for efficiency
      const user = await usersCollection.findOne(
          { email: email.toLowerCase() }, // Query by lowercase email for case-insensitivity
          {
              projection: {
                  _id: 1, // Good to include explicitly
                  isDeactivated: 1, // Manual deactivation flag
                  isAutoDeactivated: 1, // Auto deactivation flag
                  autoDeactivatedAt: 1, // Timestamp for auto deactivation
                  reactivationToken: 1, // Needed for token check
                  reactivationTokenExpires: 1, // Needed for token check
                  googleId: 1, // To check if Google linked
                  password: 1, // To check if password is set (adjust field name if needed, e.g., passwordHash)
                  lockoutUntil: 1 // Assuming you have a field for reactivation lockout
              }
          }
      );

      // 3. Handle User Not Found
      if (!user) {
          return res.status(200).json({ // 200 OK, as the *check* succeeded, even if user doesn't exist
              success: true,
              exists: false,
              message: "No account found with this email.",
              // Default flags for non-existent user
              isActive: false,
              isGoogleLinked: false,
              hasPasswordSet: false,
              isAutoDeactivated: false,
              tokenExpired: false,
              lockoutRemaining: 0,
          });
      }

      // 4. Calculate Derived Status Flags for Existing User
      const isGoogleLinked = !!user.googleId;
      const hasPasswordSet = !!user.password; // Adjust field name if needed (e.g., user.passwordHash)
      const isActive = !user.isDeactivated && !user.isAutoDeactivated;

      // Check for reactivation lockout
      const now = new Date();
      let lockoutRemaining = 0;
      if (user.lockoutUntil && new Date(user.lockoutUntil) > now) {
          lockoutRemaining = Math.max(0, Math.round((new Date(user.lockoutUntil) - now) / 1000)); // Remaining seconds
      }

      // 5. Handle Specific Status Cases

      // Case A: Auto Deactivated
      if (user.isAutoDeactivated) {
          let tokenExpired = false;
          if (!user.reactivationToken || !user.reactivationTokenExpires || new Date(user.reactivationTokenExpires) < now) {
              tokenExpired = true;
          }

          return res.status(200).json({
              success: true,
              exists: true,
              isActive: false, // Explicitly false
              isAutoDeactivated: true,
              deactivatedAt: user.autoDeactivatedAt, // Provide timestamp
              tokenExpired: tokenExpired,
              isGoogleLinked: isGoogleLinked,
              hasPasswordSet: hasPasswordSet,
              lockoutRemaining: lockoutRemaining, // Include lockout info
              message: "This account has been deactivated due to inactivity." + (lockoutRemaining > 0 ? ` Reactivation is locked for ${Math.ceil(lockoutRemaining/60)} more minutes.` : '')
          });
      }

      // Case B: Manually Deactivated or Active
      // isActive variable already calculated covers both
      return res.status(200).json({
          success: true,
          exists: true,
          isActive: isActive,
          isAutoDeactivated: false, // Explicitly false
          isGoogleLinked: isGoogleLinked,
          hasPasswordSet: hasPasswordSet,
          lockoutRemaining: 0, // No lockout concept for manual deactivation/active usually
          message: isActive ? "Account is active." : "This account has been manually deactivated."
      });

  } catch (error) {
      // 6. Handle Server Errors
      console.error("Check account status error:", error);
      res.status(500).json({
          success: false,
          message: "Server error checking account status.",
          // Optionally include error details in development
          error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

// Request a reactivation token for a deactivated account
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


//     const { email } = req.body;

//     if (!email) {
//       return res.status(400).json({
//         success: false,
//         message: "Email is required"
//       });
//     }

//     // Use a direct MongoDB query to get user regardless of active status
//     const db = mongoose.connection.db;
//     const usersCollection = db.collection('users');
//     const user = await usersCollection.findOne({ email });
    
//     if (!user) {
//       return res.status(200).json({
//         success: true,
//         exists: false,
//         message: "No account found with this email"
//       });
//     }

//     // Check account status
//     if (user.isDeactivated || user.isAutoDeactivated) {
//       // Check if there's a reactivation token and if it's expired
//       let tokenExpired = false;
//       if (!user.reactivationToken || 
//           !user.reactivationTokenExpires || 
//           new Date(user.reactivationTokenExpires) < new Date()) {
//         tokenExpired = true;
//       }

//       return res.status(200).json({
//         success: true,
//         exists: true,
//         isActive: false,
//         isDeactivated: !!user.isDeactivated,
//         isAutoDeactivated: !!user.isAutoDeactivated,
//         deactivatedAt: user.deletedAt || user.autoDeactivatedAt,
//         tokenExpired,
//         message: user.isAutoDeactivated 
//           ? "This account has been deactivated due to inactivity." 
//           : "This account has been deactivated."
//       });
//     }

//     // Account exists and is active
//     return res.status(200).json({
//       success: true,
//       exists: true,
//       isActive: true,
//       message: "Account is active."
//     });
//   } catch (error) {
//     console.error("Check account status error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message
//     });
//   }
// };