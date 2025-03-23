// middleware/verificationMiddleware.js
const User = require("../models/User");

/**
 * Middleware to check if a user's email is verified
 * This should be used after the authMiddleware
 */
const verificationMiddleware = async (req, res, next) => {
  console.log("=== VERIFICATION MIDDLEWARE STARTED ===");
  
  // The user should already be authenticated by the authMiddleware
  if (!req.user || !req.user.userId) {
    console.log("No authenticated user found");
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  try {
    // Get the full user object from the database
    console.log(`Finding user with ID: ${req.user.userId}`);
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      console.log("User not found in database");
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    console.log(`User found. Verification status: ${user.isVerified ? 'Verified' : 'Not Verified'}`);

    // Check if user is verified
    if (!user.isVerified) {
      console.log("User is not verified, denying access");
      return res.status(403).json({
        success: false,
        message: "Your account has not been verified. Please check your email for the verification code.",
        requireVerification: true,
        userId: user._id
      });
    }

    // User is verified, add the verified flag to req.user
    req.user.isVerified = true;
    console.log("User is verified, proceeding to next middleware");
    console.log("=== VERIFICATION MIDDLEWARE COMPLETED SUCCESSFULLY ===");
    next();
  } catch (error) {
    console.error("Verification middleware error:", error);
    console.log("=== VERIFICATION MIDDLEWARE FAILED ===");
    return res.status(500).json({
      success: false,
      message: "Server error during verification check",
      error: error.message
    });
  }
};

module.exports = verificationMiddleware;