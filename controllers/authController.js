// controllers/authController.js
const User = require("../models/User");
const mongoose = require('mongoose');
const bcrypt = require("bcryptjs");
const { validationResult } = require("express-validator");
const generateTokens = require("../utils/token");
const jwt = require('jsonwebtoken');
const admin = (require('../firebase/firebase'));
const { 
  sendVerificationEmail, 
  sendGoogleVerificationEmail, 
  sendPasswordResetEmail,
  sendReactivationConfirmationEmail 
} = require('../utils/emailService');
const crypto = require("crypto");
const { sendDeactivatedAccountLoginAttemptEmail, sendAutoDeactivationEmail, sendDeactivatedLoginAttempt } = require('../utils/emailService');


exports.register = async (req, res) => {
  try {
    console.log("Starting registration process...");
    
    // 1. Validate request body
    const { firstName, lastName, email, password, gender, avatar } = req.body;
    
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "All fields are required" 
      });
    }

    // 2. Check if user exists in MongoDB (including deactivated users)
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const existingUser = await usersCollection.findOne({ email });
    
    if (existingUser) {
      // Check if account is auto-deactivated - if so, return special message
      if (existingUser.isAutoDeactivated) {
        return res.status(400).json({
          success: false,
          message: "This email is associated with a deactivated account. Please login to reactivate.",
          isAutoDeactivated: true
        });
      }
      
      return res.status(400).json({ 
        success: false, 
        message: "User with this email already exists" 
      });
    }

    // 3. Create user in Firebase if using Firebase
    let firebaseUser = null;
    try {
      firebaseUser = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: `${firstName} ${lastName}`
      });
      console.log("Firebase user created:", firebaseUser.uid);
    } catch (firebaseError) {
      console.warn("Firebase user creation skipped or failed:", firebaseError.message);
      // Continue with MongoDB registration even if Firebase fails
    }

    // 4. Hash password for MongoDB
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Upload avatar to Cloudinary
    let avatarUrl = "default-avatar"; // Default avatar URL
    if (avatar) {
      try {
        const uploadResponse = await cloudinary.uploader.upload(avatar, {
          folder: 'ecopulse_avatars',
          public_id: `${email}_${Date.now()}`, // Generate a unique public_id for each user
          transformation: [{ width: 500, height: 500, crop: 'limit' }]
        });
        avatarUrl = uploadResponse.secure_url;
        console.log("Avatar uploaded to Cloudinary:", avatarUrl);
      } catch (uploadError) {
        console.error("Error uploading avatar to Cloudinary:", uploadError);
      }
    }

    // 6. Create unverified user in MongoDB
    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      googleId: firebaseUser?.uid || null, // Store Firebase UID if available
      gender: gender || "prefer-not-to-say",
      avatar: avatarUrl,
      isVerified: false, // Set as unverified
      lastActivity: new Date() // Set initial activity time
    });

    await user.save();
    console.log("MongoDB user saved:", user);

    // Verify that the user is saved correctly
    const savedUser = await User.findById(user._id);
    if (!savedUser) {
      console.error("User not found after saving:", user._id);
      return res.status(500).json({
        success: false,
        message: "Error saving user"
      });
    }

    // 7. Send verification email using the existing email service
    try {
      // Import the email service here to avoid any module loading issues
      const emailService = require('../utils/emailService');
      console.log("Email service imported, calling sendVerificationEmail...");
      
      // Explicitly call the function from the imported module
      const result = await emailService.sendVerificationEmail(user);
      console.log("Email service result:", result);
    } catch (emailError) {
      console.error("Error sending verification email:", emailError);
      console.error("Error stack:", emailError.stack);
      // Continue even if email fails, but log the error
    }

    // 8. Send success response (but don't generate JWT token yet)
    res.status(201).json({
      success: true,
      message: "User registered successfully. Please check your email for verification instructions.",
      requireVerification: true,
      userId: user._id
    });
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error
      return res.status(400).json({
        success: false,
        message: "Email is already registered"
      });
    }
    console.error("Registration Error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`Login attempt for email: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and password are required" 
      });
    }

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const rawUser = await usersCollection.findOne({ email: email });
    
    if (!rawUser) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    // Handle both manual and automatic deactivation
    if (rawUser.isDeactivated || rawUser.isAutoDeactivated) {
      console.log("Found deactivated account for login:", rawUser.email);
      
      const isMatch = await bcrypt.compare(password, rawUser.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: "Invalid credentials" });
      }

      // Generate reactivation token
      const crypto = require('crypto');
      const reactivationToken = crypto.randomBytes(32).toString("hex");
      const tokenExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      
      // Update user record
      await usersCollection.updateOne(
        { _id: rawUser._id },
        { 
          $set: {
            reactivationToken: reactivationToken,
            reactivationTokenExpires: tokenExpires,
            lastReactivationAttempt: new Date(),
            reactivationAttempts: (rawUser.reactivationAttempts || 0) + 1
          }
        }
      );
      
      try {
        // Send reactivation email to user
        await sendAutoDeactivationEmail(rawUser, reactivationToken);
        console.log("Reactivation email sent for deactivated account");

        // Notify admin about the login attempt
        await sendDeactivatedLoginAttempt(rawUser);
        console.log("Admin notified about deactivated account login attempt");
      } catch (emailError) {
        console.error("Error sending emails:", emailError);
      }
      
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. A reactivation link has been sent to your email.",
        isDeactivated: true,
        email: rawUser.email
      });
    }

    // Rest of normal login flow
    const isMatch = await bcrypt.compare(password, rawUser.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    // Update last login and activity time
    await usersCollection.updateOne(
      { _id: rawUser._id },
      { $set: { 
          lastLogin: new Date(),
          lastActivity: new Date()
        } 
      }
    );

    // Generate tokens
    const User = mongoose.model('User');
    const user = new User(rawUser);
    const { accessToken } = generateTokens(user, res);

    // Prepare response
    const responseData = {
      success: true,
      message: "Login successful",
      user: {
        id: rawUser._id,
        firstName: rawUser.firstName,
        lastName: rawUser.lastName,
        email: rawUser.email,
        gender: rawUser.gender || "prefer-not-to-say",
        avatar: rawUser.avatar || "default-avatar",
        role: rawUser.role,
        lastLogin: new Date(),
        isVerified: rawUser.isVerified === true,
        accessToken
      }
    };
    
    // Handle unverified accounts
    if (rawUser.isVerified !== true) {
      try {
        await sendVerificationEmail(rawUser);
        console.log("Verification email resent");
      } catch (emailError) {
        console.error("Error resending verification email:", emailError);
      }

      responseData.requireVerification = true;
      responseData.message = "Your account is not verified. We've sent a new verification code to your email.";
    }

    res.json(responseData);
  } catch (error) {
    console.error("Login Error:", error.message);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.verifyAuth = async (req, res) => {
  try {
    console.log("=== VERIFYING AUTH ===");
    
    // Get token from either cookie or Authorization header
    const token = req.cookies.token || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log("No token found");
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Token decoded:", { userId: decoded.userId, role: decoded.role });

    // Find user with decoded info
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      console.log("No user found with decoded ID");
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: "Your account is not verified",
        requireVerification: true,
        userId: user._id
      });
    }

    // Update user's last activity
    user.lastActivity = new Date();
    await user.save();

    res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        gender: user.gender,
        avatar: user.avatar,
        role: user.role
      }
    });
    
    console.log("=== AUTH VERIFICATION COMPLETED ===");

  } catch (error) {
    console.error("Auth verification error:", error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid token" 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: "Token expired" 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: "Server Error",
      error: error.message 
    });
  }
};

// Logout
exports.logout = (req, res) => {
  console.log("=== LOGOUT ENDPOINT CALLED ===");
  console.log("Clearing all auth cookies");
  
  // Get the full details of how the cookies were set from token.js
  // This is critical - the options must match EXACTLY
  
  // 1. Clear main auth token cookie with matching options
  res.clearCookie('token', {
    httpOnly: true,
    secure: false, // IMPORTANT: This must match how it was set
    sameSite: 'lax', 
    path: '/' // Default path if not specified when set
  });
  console.log("Cleared 'token' cookie");
  
  // 2. Clear refresh token cookie with matching options
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none', // IMPORTANT: must match how it was set
    path: '/' // Default path if not specified when set
  });
  console.log("Cleared 'refreshToken' cookie");
  
  // 3. Try alternative options for maximum compatibility
  // Sometimes browsers need different combinations
  
  // Default cookie clear (no options)
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  console.log("Also cleared cookies with no options");
  
  // Try with different sameSite options
  ['strict', 'lax', 'none'].forEach(sameSite => {
    [true, false].forEach(secure => {
      res.clearCookie('token', {
        httpOnly: true,
        secure: secure,
        sameSite: sameSite
      });
      
      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: secure,
        sameSite: sameSite
      });
    });
  });
  console.log("Attempted to clear cookies with all sameSite/secure combinations");
  
  // 4. Send success response with instruction to clear localStorage
  res.json({ 
    success: true, 
    message: "Logged out successfully",
    clearLocalStorage: true // Signal frontend to clear localStorage
  });
  
  console.log("=== LOGOUT COMPLETED ===");
};

exports.googleSignIn = async (req, res) => {
  try {
    console.log("Google Sign-In request received");
    
    // Extract data from request body
    const { idToken, email, displayName, photoURL, uid } = req.body;
    
    // Validate required fields
    if (!idToken || !email) {
      return res.status(400).json({
        success: false,
        message: "Missing required information"
      });
    }

    // Verify Firebase token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      if (decodedToken.uid !== uid) {
        console.warn("Token UID mismatch:", { 
          tokenUid: decodedToken.uid, 
          requestUid: uid 
        });
      }
    } catch (error) {
      console.error("Firebase token verification failed:", error);
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token"
      });
    }

    // Database setup
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    let user = null;

    // Check existing users
    try {
      user = await usersCollection.findOne({ email: email });
      console.log(`User lookup for ${email}:`, 
        user ? `Found (status: ${user.isAutoDeactivated ? 'auto-deactivated' : 'active'})` : "Not found");
    } catch (findError) {
      console.error("Error finding user:", findError);
      return res.status(500).json({
        success: false,
        message: "Server error during user lookup"
      });
    }

    // Handle auto-deactivated accounts
    if (user && user.isAutoDeactivated) {
      console.log("Handling auto-deactivated account:", email);
      
      try {
        // Send notifications
        await sendDeactivatedAccountLoginAttemptEmail(user);
        console.log("Deactivation notification email sent");

        // Generate reactivation token
        const reactivationToken = crypto.randomBytes(32).toString("hex");
        const tokenExpires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

        // Update user record
        await usersCollection.updateOne(
          { _id: user._id },
          { 
            $set: {
              reactivationToken: reactivationToken,
              reactivationTokenExpires: tokenExpires,
              lastReactivationAttempt: new Date(),
              reactivationAttempts: (user.reactivationAttempts || 0) + 1
            }
          }
        );

        // Send reactivation email
        await sendAutoDeactivationEmail(user, reactivationToken);
        console.log("Reactivation email sent");

        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated. A reactivation link has been sent to your email.",
          isAutoDeactivated: true,
          email: user.email
        });
      } catch (emailError) {
        console.error("Error in deactivation handling:", emailError);
        return res.status(500).json({
          success: false,
          message: "Error processing deactivated account"
        });
      }
    }

    // Handle manually deactivated accounts
    if (user && user.isDeactivated) {
      console.log("Found deleted account:", email);
      return res.status(400).json({
        success: false,
        message: "Your account has been deactivated a recovery link will be sent shortly"
      });
    }

    // Existing active user flow
    if (user && !user.isDeactivated) {
      try {
        // Update user information
        if (user.googleId !== uid || !user.lastActivity) {
          await User.findByIdAndUpdate(user._id, {
            googleId: uid,
            avatar: photoURL || user.avatar,
            lastActivity: new Date(),
            lastLogin: new Date()
          });
        }

        // Handle email verification
        if (!user.isVerified) {
          await sendGoogleVerificationEmail(user);
          return res.status(200).json({
            success: false,
            requireVerification: true,
            userId: user._id,
            user: { email: user.email },
            message: "Please verify your email to complete Google sign-in"
          });
        }

        // Finalize login for verified users
        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          { lastLogin: new Date(), lastActivity: new Date() },
          { new: true }
        );

        // Generate tokens
        const { accessToken } = generateTokens(updatedUser, res);

        return res.json({
          success: true,
          message: "Google sign-in successful",
          user: {
            id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            gender: updatedUser.gender,
            avatar: updatedUser.avatar,
            role: updatedUser.role,
            lastLogin: updatedUser.lastLogin,
            isVerified: updatedUser.isVerified,
            accessToken
          }
        });
      } catch (updateError) {
        console.error("Error updating user:", updateError);
        return res.status(500).json({
          success: false,
          message: "Error processing user account"
        });
      }
    }

    // New user creation flow
    if (!user) {
      try {
        // Parse display name
        let firstName = "Google";
        let lastName = "User";
        if (displayName && displayName.includes(' ')) {
          const nameParts = displayName.split(' ');
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(' ');
        }

        // Create new user
        const newUser = new User({
          firstName,
          lastName,
          email,
          googleId: uid,
          avatar: photoURL || "default-avatar",
          gender: "prefer-not-to-say",
          isVerified: false,
          lastActivity: new Date(),
          lastLogin: new Date()
        });

        await newUser.save();
        console.log("New user created:", newUser._id);

        // Send verification email
        await sendGoogleVerificationEmail(newUser);

        return res.status(200).json({
          success: false,
          requireVerification: true,
          userId: newUser._id,
          user: { email: newUser.email },
          message: "Please verify your email to complete Google sign-in"
        });
      } catch (creationError) {
        console.error("Error creating user:", creationError);
        return res.status(500).json({
          success: false,
          message: "Error creating new account",
          error: creationError.message
        });
      }
    }

    // Fallback error
    throw new Error("Unexpected error processing Google sign-in");

  } catch (error) {
    console.error("Google Sign-In Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during authentication",
      error: error.message
    });
  }
};

// Email verification endpoint
exports.verifyEmail = async (req, res) => {
  try {
    const { userId, verificationCode } = req.body;

    if (!userId || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: "User ID and verification code are required"
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

    // Check if already verified
    if (user.isVerified) {
      return res.json({
        success: true,
        message: "Email already verified",
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        }
      });
    }

    // Check verification code
    if (user.verificationCode !== verificationCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code"
      });
    }

    // Check if code is expired
    if (user.verificationCodeExpires && user.verificationCodeExpires < new Date()) {
      // Generate a new code and send it
      try {
        await sendVerificationEmail(user);
      } catch (emailError) {
        console.error("Error resending verification email:", emailError);
      }

      return res.status(400).json({
        success: false,
        message: "Verification code has expired. A new code has been sent to your email."
      });
    }

    // Verify the user
    user.isVerified = true;
    user.verificationCode = undefined; // Clear the code
    user.verificationCodeExpires = undefined;
    user.lastActivity = new Date(); // Update last activity
    await user.save();

    // Generate tokens
    const { accessToken } = generateTokens(user, res);

    // Return success
    res.json({
      success: true,
      message: "Email verification successful",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        gender: user.gender,
        avatar: user.avatar,
        role: user.role,
        lastLogin: user.lastLogin,
        accessToken
      }
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

// Resend verification code
exports.resendVerificationCode = async (req, res) => {
  try {
    const { userId } = req.body;

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

    // Check if already verified
    if (user.isVerified) {
      return res.json({
        success: true,
        message: "Email already verified"
      });
    }

    // Send new verification email
    try {
      await sendVerificationEmail(user);
    } catch (emailError) {
      console.error("Error resending verification email:", emailError);
      return res.status(500).json({
        success: false,
        message: "Failed to send verification email",
        error: emailError.message
      });
    }

    res.json({
      success: true,
      message: "Verification code has been resent to your email"
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email, platform } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // Use Mongoose to find the user
    const user = await User.findOne({ 
      email,
      isDeactivated: { $ne: true }
    });
    
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If that email address is in our database, we will send a password reset link."
      });
    }

    // Handle auto-deactivated accounts
    if (user.isAutoDeactivated) {
      user.isAutoDeactivated = false;
      user.autoDeactivatedAt = null;
      user.reactivationToken = null;
      user.reactivationTokenExpires = null;
      user.lastActivity = new Date();
      console.log("Auto-deactivated account reactivated during password reset");
    }
    
    // Generate the full security token (kept private)
    const resetToken = crypto.randomBytes(20).toString("hex");
    
    // Generate a short 6-character alphanumeric code for user-friendly display
    // Using only uppercase letters and numbers for better readability
    const shortCode = generateShortCode(6);
    console.log(`Generated short code ${shortCode} for user ${user.email}`);
    
    // Save both tokens
    user.resetPasswordToken = resetToken;
    user.resetPasswordShortCode = shortCode; // Add this field to your User model
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    // Send password reset email with the short code
    try {
      await sendPasswordResetEmail(user, resetToken, shortCode, platform || 'unknown');
    } catch (emailError) {
      console.error("Error sending password reset email:", emailError);
      return res.status(500).json({
        success: false,
        message: "Error sending password reset email",
        error: emailError.message
      });
    }

    res.status(200).json({
      success: true, 
      message: "If that email address is in our database, we will send a password reset link."
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: error.message 
    });
  }
};

// Generate a random alphanumeric code of specified length
function generateShortCode(length) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar looking characters: I, 1, O, 0
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  
  return result;
}

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    console.log("Reset password request received:");
    console.log("- Token length:", token?.length);
    
    if (!token || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: "Token and new password are required." 
      });
    }

    // Find user either by full token or short code based on token length
    let userWithToken;
    if (token.length <= 8) { // Short code
      console.log("Processing as short code");
      userWithToken = await User.findOne({
        resetPasswordShortCode: token
      });
    } else { // Full token
      console.log("Processing as full token");
      userWithToken = await User.findOne({
        resetPasswordToken: token
      });
    }
    
    if (!userWithToken) {
      console.log("No user found with this token/code");
      return res.status(400).json({
        success: false,
        message: "Password reset token is invalid or has expired.",
        details: "Token not found in database"
      });
    }
    
    // Check expiration separately for better debugging
    if (userWithToken.resetPasswordExpires < Date.now()) {
      console.log("Token found but expired:");
      console.log("- Token expiration:", new Date(userWithToken.resetPasswordExpires));
      console.log("- Current time:", new Date());
      
      return res.status(400).json({
        success: false,
        message: "Password reset token is invalid or has expired.",
        details: "Token has expired",
        expired: true
      });
    }

    // Validation passed - token is valid and not expired
    console.log("Valid token found for user:", userWithToken.email);
    
    // Password requirements validation
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long."
      });
    }
    
    // Hash the new password using bcrypt
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    userWithToken.password = hashedPassword;
    
    // Clear the reset token fields
    userWithToken.resetPasswordToken = undefined;
    userWithToken.resetPasswordShortCode = undefined;
    userWithToken.resetPasswordExpires = undefined;
    
    // Update last activity
    userWithToken.lastActivity = new Date();
    await userWithToken.save();

    // Optionally generate a new JWT for immediate login
    const { accessToken, refreshToken } = generateTokens(userWithToken, res);

    res.json({
      success: true,
      message: "Password has been successfully reset.",
      accessToken,
      refreshToken,
      email: userWithToken.email
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error during password reset", 
      error: error.message 
    });
  }
};

exports.getDeactivatedUsers = async (req, res) => {
  try {
    console.log('Processing request for deactivated users');
    
    // This query explicitly asks for deactivated users, bypassing the middleware
    const deactivatedUsers = await User.find({ isDeactivated: true })
      .select('-password')
      .sort({ deactivatedAt: -1 });
    
    console.log(`Found ${deactivatedUsers.length} deactivated users`);
    
    // Also check for auto-deactivated users
    const autoDeactivatedUsers = await User.find({ isAutoDeactivated: true })
      .select('-password')
      .sort({ autoDeactivatedAt: -1 });
    
    console.log(`Found ${autoDeactivatedUsers.length} auto-deactivated users`);
    
    // Check for users with deleted/deactivated status but not marked as deactivated
    const statusDeactivatedUsers = await User.find({
      $or: [
        { status: 'deleted' },
        { status: 'deactivated' },
        { status: 'inactive' }
      ],
      isDeactivated: { $ne: true },
      isAutoDeactivated: { $ne: true }
    })
    .select('-password');
    
    console.log(`Found ${statusDeactivatedUsers.length} users with deactivated status`);
    
    // Combine all types of deactivated users
    const allDeactivatedUsers = [
      ...deactivatedUsers,
      ...autoDeactivatedUsers,
      ...statusDeactivatedUsers
    ];
    
    // Remove duplicates by ID
    const uniqueUsers = Array.from(
      new Map(allDeactivatedUsers.map(user => [user._id.toString(), user])).values()
    );
    
    console.log(`Returning ${uniqueUsers.length} unique deactivated users`);
    
    res.json({
      success: true,
      users: uniqueUsers,
      counts: {
        deactivated: deactivatedUsers.length,
        autoDeactivated: autoDeactivatedUsers.length,
        statusDeactivated: statusDeactivatedUsers.length,
        total: uniqueUsers.length
      }
    });
  } catch (error) {
    console.error('Error fetching deactivated users:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching deactivated users',
      error: error.message
    });
  }
};


exports.verifyResetCode = async (req, res) => {
  try {
    const { shortCode, email } = req.body;
    
    if (!shortCode || !email) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and verification code are required" 
      });
    }

    console.log(`Verifying code ${shortCode} for email ${email}`);

    // Find user with matching short code
    const user = await User.findOne({
      email,
      resetPasswordShortCode: shortCode,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification code"
      });
    }

    console.log(`Valid code found for user ${user.email}`);

    // Return the full token for the frontend
    return res.status(200).json({
      success: true,
      token: user.resetPasswordToken
    });
    
  } catch (error) {
    console.error("Error verifying reset code:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};