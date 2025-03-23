const jwt = require("jsonwebtoken");

/**
 * Generate access and refresh tokens for a user
 * @param {Object} user - User document from MongoDB
 * @param {Object} res - Express response object for setting cookies
 * @param {Boolean} isMobile - Flag to indicate if request is from mobile app
 * @return {Object} Object containing tokens
 */
const generateTokens = (user, res = null, isMobile = false) => {
  console.log("=== GENERATING TOKENS ===");
  console.log("User input:", {
    id: user._id,
    role: user.role
  });
  
  console.log("JWT_SECRET available:", process.env.JWT_SECRET ? "Yes" : "No");
  console.log("JWT_REFRESH_SECRET available:", process.env.JWT_REFRESH_SECRET ? "Yes" : "No");
  console.log("Is mobile request:", isMobile ? "Yes" : "No");
  
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.error("ERROR: JWT secret keys are missing in environment variables!");
  }

  // Create payload with ALL user fields (except password)
  const userPayload = {
    userId: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    // phone: user.phone || "", // Remove this line as it's not in your schema
    role: user.role,
    isVerified: user.isVerified || false,
    avatar: user.avatar || "default-avatar", // Change from profilePicture to avatar
    gender: user.gender || "prefer-not-to-say", // Add this field from schema
    lastLogin: user.lastLogin || new Date(),
    googleId: user.googleId || null,
    createdAt: user.createdAt || new Date(),
    updatedAt: user.updatedAt || new Date(),
    verificationStatus: user.isVerified ? 'verified' : 'pending'
  };
  
  console.log("Token payload being generated:", userPayload);
  
  // Generate access token
  const accessToken = jwt.sign(
    userPayload,
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  
  console.log("Access token generated");
  
  // Generate refresh token with minimal info (just userId for security)
  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
  
  console.log("Refresh token generated");
  
  // Set cookies if response object is provided AND not mobile request
  if (res && !isMobile) {
    console.log("Setting cookies (web client)");
    
    // Set access token cookie
    res.cookie("token", accessToken, {
      httpOnly: true,
      secure: false, // Match your existing cookie settings
      sameSite: "lax", // Match your existing cookie settings
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    console.log("Cookies set successfully");
  } else if (isMobile) {
    console.log("Mobile client - tokens will be sent in response body");
  } else {
    console.log("No response object provided, skipping cookie setting");
  }
  
  console.log("=== TOKEN GENERATION COMPLETED ===");
  
  return {
    accessToken,
    refreshToken,
    user: userPayload // Adding user info to the return object
  };
};

module.exports = generateTokens;