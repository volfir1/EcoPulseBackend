// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const { 
  getDashboardSummary,
  getAccountActivities,
  markActivityAsRead,
  markAllActivitiesAsRead,
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getActivityReport
} = require("../controllers/adminController");
const accountController = require("../controllers/accountController");

const authMiddleware = require("../middleware/auth").authenticateJWT;
const adminMiddleware = require("../middleware/auth").isAdmin;

// Apply auth and admin middleware to all routes
router.use(authMiddleware, adminMiddleware);

// Dashboard summary route
router.get('/dashboard', getDashboardSummary);

// Account activities routes
router.get('/activities', getAccountActivities);
router.patch('/activities/:activityId/read', markActivityAsRead);
router.patch('/activities/read-all', markAllActivitiesAsRead);

// Notifications routes
router.get('/notifications', getNotifications);
router.patch('/notifications/:notificationId/read', markNotificationAsRead);
router.patch('/notifications/read-all', markAllNotificationsAsRead);

// Activity report route (for export)
router.get('/reports/activity', getActivityReport);

// User management routes from accountController
router.post('/users/deactivate', accountController.adminDeactivateUser);
router.post('/users/restore', accountController.adminRestoreUser);

// Auto-deactivation monitoring routes
router.get('/auto-deactivation/stats', async (req, res) => {
  try {
    const User = require('../models/User');
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Get count of auto-deactivated accounts
    const autoDeactivatedCount = await usersCollection.countDocuments({ 
      isAutoDeactivated: true,
      isDeactivated: false
    });
    
    // Get count of accounts with expired reactivation tokens
    const expiredTokensCount = await usersCollection.countDocuments({
      reactivationTokenExpires: { $lt: new Date() },
      $or: [
        { isAutoDeactivated: true },
        { isDeactivated: true }
      ]
    });
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    // Get recently deactivated accounts
    const recentDeactivations = await usersCollection.countDocuments({
      autoDeactivatedAt: { $gte: oneWeekAgo }
    });
    
    // Get login attempts to inactive accounts
    const inactiveLoginAttempts = await usersCollection.countDocuments({
      lastReactivationAttempt: { $gte: oneWeekAgo }
    });
    
    // Get accounts that were successfully reactivated
    const reactivatedAccounts = await usersCollection.countDocuments({
      reactivatedAt: { $gte: oneWeekAgo }
    });
    
    res.json({
      success: true,
      data: {
        autoDeactivatedCount,
        expiredTokensCount,
        recentDeactivations,
        inactiveLoginAttempts,
        reactivatedAccounts
      }
    });
  } catch (error) {
    console.error('Error getting auto-deactivation stats:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get inactive account login attempts
router.get('/inactive-account-logins', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Get timeframe from query params or default to last 30 days
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Find users with recent reactivation attempts
    const users = await usersCollection.find({
      lastReactivationAttempt: { $gte: startDate }
    })
    .sort({ lastReactivationAttempt: -1 })
    .skip(skip)
    .limit(limit)
    .project({
      _id: 1,
      firstName: 1,
      lastName: 1,
      email: 1,
      autoDeactivatedAt: 1,
      deletedAt: 1,
      lastReactivationAttempt: 1,
      reactivationAttempts: 1,
      reactivatedAt: 1,
      isAutoDeactivated: 1,
      isDeactivated: 1
    })
    .toArray();
    
    // Get total count for pagination
    const total = await usersCollection.countDocuments({
      lastReactivationAttempt: { $gte: startDate }
    });
    
    // Process users to make the response cleaner
    const processedUsers = users.map(user => ({
      id: user._id.toString(),
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown',
      email: user.email,
      status: user.isDeactivated ? 'Deleted' : (user.isAutoDeactivated ? 'Auto-deactivated' : 'Active'),
      deactivatedAt: user.autoDeactivatedAt || user.deletedAt,
      lastLoginAttempt: user.lastReactivationAttempt,
      totalAttempts: user.reactivationAttempts || 0,
      reactivatedAt: user.reactivatedAt,
      wasReactivated: !!user.reactivatedAt
    }));
    
    res.json({
      success: true,
      data: {
        attempts: processedUsers,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit
        },
        timeframe: {
          days,
          startDate,
          endDate: new Date()
        }
      }
    });
  } catch (error) {
    console.error('Error getting inactive account login attempts:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Generate reactivation metrics report
router.get('/reports/reactivation-metrics', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Get time ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    // Get auto-deactivation counts
    const deactivatedTotal = await usersCollection.countDocuments({
      $or: [{ isAutoDeactivated: true }, { isDeactivated: true }]
    });
    
    const deactivatedToday = await usersCollection.countDocuments({
      autoDeactivatedAt: { $gte: today }
    });
    
    const deactivatedWeek = await usersCollection.countDocuments({
      autoDeactivatedAt: { $gte: oneWeekAgo }
    });
    
    const deactivatedMonth = await usersCollection.countDocuments({
      autoDeactivatedAt: { $gte: oneMonthAgo }
    });
    
    // Get login attempt counts for inactive accounts
    const loginAttemptsTotal = await usersCollection.countDocuments({
      reactivationAttempts: { $gt: 0 }
    });
    
    const loginAttemptsToday = await usersCollection.countDocuments({
      lastReactivationAttempt: { $gte: today }
    });
    
    const loginAttemptsWeek = await usersCollection.countDocuments({
      lastReactivationAttempt: { $gte: oneWeekAgo }
    });
    
    const loginAttemptsMonth = await usersCollection.countDocuments({
      lastReactivationAttempt: { $gte: oneMonthAgo }
    });
    
    // Get reactivation counts
    const reactivatedTotal = await usersCollection.countDocuments({
      reactivatedAt: { $exists: true }
    });
    
    const reactivatedToday = await usersCollection.countDocuments({
      reactivatedAt: { $gte: today }
    });
    
    const reactivatedWeek = await usersCollection.countDocuments({
      reactivatedAt: { $gte: oneWeekAgo }
    });
    
    const reactivatedMonth = await usersCollection.countDocuments({
      reactivatedAt: { $gte: oneMonthAgo }
    });
    
    // Calculate reactivation rate percentage
    const weeklyReactivationRate = loginAttemptsWeek > 0 
      ? (reactivatedWeek / loginAttemptsWeek * 100).toFixed(2)
      : 0;
    
    const monthlyReactivationRate = loginAttemptsMonth > 0
      ? (reactivatedMonth / loginAttemptsMonth * 100).toFixed(2)
      : 0;
    
    const overallReactivationRate = loginAttemptsTotal > 0
      ? (reactivatedTotal / loginAttemptsTotal * 100).toFixed(2)
      : 0;
    
    res.json({
      success: true,
      data: {
        deactivations: {
          total: deactivatedTotal,
          today: deactivatedToday,
          week: deactivatedWeek,
          month: deactivatedMonth
        },
        loginAttempts: {
          total: loginAttemptsTotal,
          today: loginAttemptsToday,
          week: loginAttemptsWeek,
          month: loginAttemptsMonth
        },
        reactivations: {
          total: reactivatedTotal,
          today: reactivatedToday,
          week: reactivatedWeek,
          month: reactivatedMonth
        },
        reactivationRates: {
          weekly: parseFloat(weeklyReactivationRate),
          monthly: parseFloat(monthlyReactivationRate),
          overall: parseFloat(overallReactivationRate)
        },
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('Error generating reactivation metrics report:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;