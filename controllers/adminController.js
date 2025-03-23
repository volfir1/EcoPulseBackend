// controllers/adminController.js
const User = require('../models/User');
const ActivityLog = require('../models/Activity');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// Get dashboard summary for admin
exports.getDashboardSummary = async (req, res) => {
  try {
    // Verify admin role (you should have middleware for this as well)
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    // Get counts from various collections
    const totalUsers = await User.countDocuments();
    const deactivatedAccounts = await User.countDocuments({ isDeactivated: true });
    const recoveredUsers = await ActivityLog.countDocuments({ 
      type: 'account_reactivated', 
      status: 'completed' 
    });

    // Get today's activities
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayActivities = await ActivityLog.countDocuments({
      timestamp: { $gte: today }
    });

    // Get this week's deactivations and recoveries
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const weeklyDeactivations = await ActivityLog.countDocuments({
      type: 'account_deactivated',
      status: 'completed',
      timestamp: { $gte: oneWeekAgo }
    });
    
    const weeklyRecoveries = await ActivityLog.countDocuments({
      type: 'account_reactivated',
      status: 'completed',
      timestamp: { $gte: oneWeekAgo }
    });

    // Get pending recovery requests
    const pendingRecoveries = await User.countDocuments({
      isDeactivated: true,
      recoveryToken: { $ne: null },
      recoveryTokenExpires: { $gt: new Date() }
    });

    // Return dashboard summary
    res.json({
      success: true,
      data: {
        totalUsers,
        deactivatedAccounts,
        recoveredAccounts: recoveredUsers,
        todayActivities,
        weeklyDeactivations,
        weeklyRecoveries,
        pendingRecoveries
      }
    });
  } catch (error) {
    console.error('Error getting dashboard summary:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get account activities
exports.getAccountActivities = async (req, res) => {
  try {
    // Verify admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get activities with user details
    const activities = await ActivityLog.find()
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await ActivityLog.countDocuments();

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
          limit
        }
      }
    });
  } catch (error) {
    console.error('Error getting account activities:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Mark activity as read


// Get detailed account activity report (for export)
exports.getActivityReport = async (req, res) => {
  try {
    // Verify admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin role required.'
      });
    }

    // Get filter parameters
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const activityType = req.query.type;
    const status = req.query.status;

    // Build filter
    const filter = {};
    
    if (startDate && endDate) {
      filter.timestamp = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filter.timestamp = { $gte: startDate };
    } else if (endDate) {
      filter.timestamp = { $lte: endDate };
    }
    
    if (activityType) {
      filter.type = activityType;
    }
    
    if (status) {
      filter.status = status;
    }

    // Get activities
    const activities = await ActivityLog.find(filter)
      .sort({ timestamp: -1 });

    // Get user details if needed
    const activitiesWithUserDetails = await Promise.all(
      activities.map(async (activity) => {
        if (activity.userId) {
          const user = await User.findById(activity.userId).select('firstName lastName email');
          return {
            ...activity.toObject(),
            userDetails: user ? {
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email
            } : null
          };
        }
        return activity.toObject();
      })
    );

    res.json({
      success: true,
      data: {
        activities: activitiesWithUserDetails,
        count: activitiesWithUserDetails.length,
        filters: {
          startDate,
          endDate,
          activityType,
          status
        }
      }
    });
  } catch (error) {
    console.error('Error getting activity report:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};