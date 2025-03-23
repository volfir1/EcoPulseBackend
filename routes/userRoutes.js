// Updated routes/userRoutes.js

const express = require('express');
const router = express.Router();
const { 
  getUserById, 
  updateUserProfile, 
  changePassword, 
  softDeleteUser, 
  getAllDeactivated,
  restoreUser,
  deleteAllUsers,
  updateOnboarding  // Add the new onboarding function
} = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Delete all users - NO AUTH REQUIRED
// WARNING: This route is not protected and can delete all users
router.delete('/deleteall', deleteAllUsers);

// Authenticated routes
// Get specific user by ID
router.get('/:id', authMiddleware, getUserById);

// Update user profile
router.put('/:id', authMiddleware, updateUserProfile);

// Onboarding profile update - specific endpoint for onboarding flow
router.post('/onboarding', authMiddleware, updateOnboarding);

// Change password
router.put('/:id/password', authMiddleware, changePassword);

// Soft delete user
router.delete('/:id', authMiddleware, softDeleteUser);

// Admin routes
router.get('/all', authMiddleware, adminMiddleware, getAllDeactivated);
router.put('/:id/restore', authMiddleware, adminMiddleware, restoreUser);

module.exports = router;