// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async (req, res, next) => {
  // Reuse the mobile detection function from authController
  const isMobileRequest = (req) => {
    return req.get('x-client-type') === 'mobile' || req.body.clientType === 'mobile';
  };
  const mobile = isMobileRequest(req);

  // Define public routes that don't need auth
  const publicRoutes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
    '/api/auth/reset-password',
    '/api/auth/forgot-password',
    '/api/auth/google-signin'
  ];

  // Skip middleware for public routes
  if (publicRoutes.includes(req.path)) {
    return next();
  }

  // Get token from header or cookie
  let token = req.cookies?.token;
  const authHeader = req.header("Authorization");
  
  if (!token && authHeader) {
    token = authHeader.startsWith("Bearer ") 
      ? authHeader.split(" ")[1].trim() 
      : authHeader.trim();
  }

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: "Authentication required" 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // Add soft-deleted user check
    if (user.isDeactivated) {
      return res.status(403).json({
        success: false,
        message: "Account has been deactivated"
      });
    }

    // Set user data on request
    req.user = {
      id: user._id,  
      userId: user._id,  // Keep this for backward compatibility
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      lastActivity: new Date()
    };
    
    // Update lastActivity in database
    await User.findByIdAndUpdate(user._id, { lastActivity: new Date() });

    // Token refresh logic with mobile support
    const tokenExp = decoded.exp * 1000;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (tokenExp - now < fiveMinutes) {
      try {
        const newToken = jwt.sign(
          { userId: user._id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        if (!mobile) {
          // For web: Set cookie
          res.cookie('token', newToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 3600000 // 1 hour
          });
        }
        
        // For both web and mobile: Set header
        res.setHeader('X-New-Token', newToken);
        
        // For mobile: Store in res.locals to include in response
        res.locals.newToken = newToken;
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
      }
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: "Token expired",
        requireRefresh: true
      });
    }

    res.status(401).json({ 
      success: false, 
      message: "Invalid authentication" 
    });
  }
};