// routes/authRoutes.js
const express = require("express");
const { body } = require("express-validator");
const authController = require("../controllers/authController");
const accountController = require("../controllers/accountController");
const userController = require("../controllers/userController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const router = express.Router();
const{
  forgotPassword,
  resetPassword,
  googleSignIn,
  verifyEmail,
  resendVerificationCode,
  logout,
  verifyAuth,
  getDeactivatedUsers,
  verifyResetCode
} = require('../controllers/authController');
const User = require('../models/User');

const{
  deactivateAccount,
  reactivateAccount,
  requestReactivation,
  checkAccountStatus,
  checkDeactivatedAccount,
  adminDeactivateUser,
  debugAutoDeactivatedAccounts
} = require('../controllers/accountController');

const{
  getAllUsers,
  updateUserRole
}= require('../controllers/userController')

// Registration and login routes (no auth required)
router.post(
  "/register",
  [
    body("firstName", "First name is required").not().isEmpty(),
    body("lastName", "Last name is required").not().isEmpty(),
    body("email", "Valid email is required").isEmail(),
    body("password", "Password must be at least 6 characters").isLength({ min: 6 }),
  ],
  authController.register
);

router.post(
  "/login",
  [
    body("email", "Valid email is required").isEmail(),
    body("password", "Password is required").exists(),
  ],
  authController.login
);

// Password routes
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post('/verify-reset-code', verifyResetCode);
// Account management routes
router.post("/deactivate-account", authMiddleware, deactivateAccount);
router.post("/reactivate-account", reactivateAccount);
router.post("/request-reactivation", requestReactivation);
router.post("/check-account-status", checkAccountStatus);
router.post("/check-deactivated", checkDeactivatedAccount);

// Google Authentication endpoint (no auth required)
router.post("/google-signin", googleSignIn);

// Email verification endpoints (no auth required for direct verification)
router.post("/verify-email", verifyEmail);

// Resend verification requires auth but not verification
router.post("/resend-verification", resendVerificationCode);

// Logout (no auth required)
router.post("/logout", logout);

// Check auth status (requires auth)
router.get('/verify', authMiddleware, verifyAuth);

// Admin routes (require auth and admin role)
router.get('/users', authMiddleware, adminMiddleware, getAllUsers);
router.get('/users/deactivated', authMiddleware, adminMiddleware, getDeactivatedUsers);
router.post('/users/query', authMiddleware, adminMiddleware, getDeactivatedUsers);
router.put('/users/:userId/role', authMiddleware, adminMiddleware, updateUserRole);
router.post('/admin/deactivate-user', authMiddleware, adminMiddleware, adminDeactivateUser);

// Debug routes
router.get('/debug/email-service', accountController.debugEmailService);
router.get('/debug/deactivated-accounts', authMiddleware, adminMiddleware, debugAutoDeactivatedAccounts);

router.get('/verify-token', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Token is required"
      });
    }
    
    // Log the token for debugging
    console.log("Verifying token:", token);
    console.log("Token length:", token.length);
    
    // Find user with matching token
    const user = await User.findOne({ resetPasswordToken: token });
    
    if (!user) {
      console.log("No user found with token");
      return res.status(400).json({
        success: false,
        message: "Token not found in database",
        validToken: false
      });
    }
    
    // Check if token is expired
    const isExpired = user.resetPasswordExpires < Date.now();
    
    console.log("Token found for user:", user.email);
    console.log("Token expires:", new Date(user.resetPasswordExpires));
    console.log("Current time:", new Date());
    console.log("Token expired:", isExpired);
    
    return res.json({
      success: true,
      validToken: !isExpired,
      isExpired: isExpired,
      expiresAt: user.resetPasswordExpires,
      email: user.email,
      // Don't include sensitive information here
      message: isExpired ? "Token has expired" : "Token is valid"
    });
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during token verification",
      error: error.message
    });
  }
});
module.exports = router;