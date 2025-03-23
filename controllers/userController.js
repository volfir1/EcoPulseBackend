
  const User = require("../models/User");
  const mongoose = require("mongoose"); // Make sure to import mongoose
  const bcrypt = require("bcryptjs");
  exports.getAllUsers = async (req, res) => {
      try {
        const users = await User.find()
          .select('-password')
          .sort({ createdAt: -1 });
    
        const usersWithStats = {
          users,
          stats: {
            total: users.length,
            active: users.filter(user => user.lastLogin).length,
            inactive: users.filter(user => !user.lastLogin).length,
            newUsers: users.filter(user => {
              const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
              return new Date(user.createdAt) > thirtyDaysAgo;
            }).length
          }
        };
    
        res.json({
          success: true,
          ...usersWithStats
        });
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ 
          success: false, 
          message: 'Error fetching users' 
        });
      }
    };
    // Fix 3: Separate getUserById into its own export
    exports.getUserById = async (req, res) => {
      try {
        const userId = req.params.id;
    
        const user = await User.findById(userId)
          .select('-password')
          .select('firstName lastName email role lastLogin');
    
        if (!user) {
          return res.status(404).json({
            success: false,
            message: "User not found"
          });
        }
    
        res.json({
          success: true,
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            lastLogin: user.lastLogin,
            accessToken
          }
        });
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({
          success: false,
          message: "Server Error",
          error: error.message
        });
      }
    };

    exports.updateUserRole = async (req, res) => {
      try {
        const { userId } = req.params;
        const { role } = req.body;
    
        // Validate role
        if (!['user', 'admin'].includes(role)) {
          return res.status(400).json({
            success: false,
            message: "Invalid role specified"
          });
        }
    
        // Find and update user
        const user = await User.findByIdAndUpdate(
          userId,
          { role },
          { new: true }
        ).select('-password');
    
        if (!user) {
          return res.status(404).json({
            success: false,
            message: "User not found"
          });
        }
    
        res.json({
          success: true,
          message: "User role updated successfully",
          user
        });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).json({
          success: false,
          message: "Server Error",
          error: error.message
        });
      }
    };

    exports.updateUserProfile = async (req, res) => {
      try {
        const userId = req.params.id;
        const { firstName, lastName, email, phone, gender, avatar } = req.body;
        
        // Prevent email duplication check against other users
        if (email) {
          const existingUser = await User.findOne({ 
            email, 
            _id: { $ne: userId } 
          });
          
          if (existingUser) {
            return res.status(400).json({
              success: false,
              message: "Email is already in use by another account"
            });
          }
        }
        
        // Validate gender if provided
        if (gender) {
          const validGenders = ["male", "female", "non-binary", "transgender", "other", "prefer-not-to-say"];
          if (!validGenders.includes(gender)) {
            return res.status(400).json({
              success: false,
              message: "Invalid gender option"
            });
          }
        }
        
        // Find and update user
        const updatedUser = await User.findByIdAndUpdate(
          userId,
          {
            ...(firstName && { firstName }),
            ...(lastName && { lastName }),
            ...(email && { email }),
            ...(phone !== undefined && { phone }),
            ...(gender && { gender }),
            ...(avatar && { avatar }),
            lastActivity: new Date() // Update last activity time
          },
          { new: true }
        ).select('-password');
        
        if (!updatedUser) {
          return res.status(404).json({
            success: false,
            message: "User not found"
          });
        }
        
        res.json({
          success: true,
          message: "Profile updated successfully",
          user: {
            id: updatedUser._id,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            email: updatedUser.email,
            phone: updatedUser.phone || "",
            gender: updatedUser.gender,
            avatar: updatedUser.avatar,
            role: updatedUser.role
          }
        });
      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({
          success: false,
          message: "Server Error",
          error: error.message
        });
      }
    };
    
    // Change password
exports.changePassword = async (req, res) => {
  try {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;
    
    console.log("Change password request for user:", userId);
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format"
      });
    }
    
    // Find user with password - IMPORTANT: Include password in the query
    const user = await User.findById(userId).select('+password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Check if password exists in the user object
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: "Cannot change password for this account type"
      });
    }
    
    console.log("User found, attempting password comparison");
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect"
      });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    user.password = hashedPassword;
    user.lastActivity = new Date();
    await user.save();
    
    res.json({
      success: true,
      message: "Password updated successfully"
    });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};
    
    // Soft delete user
    exports.softDeleteUser = async (req, res) => {
      try {
        const userId = req.params.id;
        
        // First find the user to get their current data
        const userToDelete = await User.findById(userId);
        
        if (!userToDelete) {
          return res.status(404).json({
            success: false,
            message: "User not found"
          });
        }
        
        // Store original data
        const originalEmail = userToDelete.email;
        const originalPhone = userToDelete.phone;
        
        // Update with deleted status and store original data in new fields
        const user = await User.findByIdAndUpdate(
          userId,
          { 
            isDeactivated: true, // Ensure this is explicitly set to true
            email: `deleted_${userId}@removed.user`,
            phone: null,
            // Store original data in new fields
            originalEmail: originalEmail,
            originalPhone: originalPhone
          },
          { new: true }
        );
        
        // Verify that isDeactivated was actually set to true
        if (!user.isDeactivated) {
          // If it wasn't set for some reason, force an update
          await User.updateOne(
            { _id: userId },
            { $set: { isDeactivated: true } }
          );
        }
        
        res.json({
          success: true,
          message: "User has been successfully deactivated"
        });
      } catch (error) {
        console.error("Error deactivating user:", error);
        res.status(500).json({
          success: false,
          message: "Server Error",
          error: error.message
        });
      }
    };

// Restore a soft-deleted user
exports.restoreUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Find the deleted user by ID and ensure it's marked as deleted
    const deletedUser = await User.findOne({
      _id: userId,
      isDeactivated: true
    }).select('+originalEmail +originalPhone');

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "Deleted user not found or already active"
      });
    }

    // Restore the user's original email and phone
    if (deletedUser.originalEmail) {
      deletedUser.email = deletedUser.originalEmail;
      deletedUser.originalEmail = undefined;
    }

    if (deletedUser.originalPhone) {
      deletedUser.phone = deletedUser.originalPhone;
      deletedUser.originalPhone = undefined;
    }

    // Make sure to set isDeactivated to false
    deletedUser.isDeactivated = false;

    // Save the changes
    await deletedUser.save();

    res.json({
      success: true,
      message: "User has been successfully restored",
      user: {
        id: deletedUser._id,
        firstName: deletedUser.firstName,
        lastName: deletedUser.lastName,
        email: deletedUser.email,
        phone: deletedUser.phone,
        role: deletedUser.role
      }
    });
  } catch (error) {
    console.error("Error restoring user:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};


  // Get all users including deleted ones (admin only)
  exports.getAllDeactivated= async (req, res) => {
    try {
      // Use a raw find query without the middleware filter
      const users = await User.find({})
        .select('-password')
        .sort({ createdAt: -1 });
      
      // Mark which users are deleted in the response
      const formattedUsers = users.map(user => ({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        isDeactivated: user.isDeactivated || false,
        lastLogin: user.lastLogin
      }));
      
      res.json({
        success: true,
        users: formattedUsers,
        stats: {
          total: users.length,
          active: users.filter(user => !user.isDeactivated).length,
          deleted: users.filter(user => user.isDeactivated).length
        }
      });
    } catch (error) {
      console.error("Error fetching all users:", error);
      res.status(500).json({
        success: false,
        message: "Server Error",
        error: error.message
      });
    }
  };


  exports.deleteAllUsers = async (req, res) => {
    try {
      // Get the count before deletion for reporting
      const userCount = await User.countDocuments({});
      
      // Direct database operation to bypass middleware
      const result = await mongoose.connection.db.collection('users').deleteMany({});
      
      // Log the deletion
      console.log(`Deleted all ${result.deletedCount} users from database`);

      // Return the result
      res.status(200).json({
        success: true,
        message: `Successfully deleted all users (${result.deletedCount} records)`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error("Error deleting all users:", error);
      res.status(500).json({
        success: false,
        message: "Server Error",
        error: error.message
      });
    }
  };

  exports.updateOnboarding = async (req, res) => {
    try {
      const { gender, avatar, hasCompletedOnboarding } = req.body;
      const userId = req.user.id || req.user.userId;
      
      console.log('Onboarding update request:', {
        userId,
        gender,
        avatarLength: avatar ? avatar.length : 0,
        hasCompletedOnboarding
      });
      
      // Check if we have a valid user ID
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User ID not found in request"
        });
      }
      
      // Update the user
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          gender,
          avatar,  // This should now always be a Cloudinary URL
          hasCompletedOnboarding,
          lastActivity: new Date()
        },
        { new: true }
      ).select('-password');
      
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } catch (error) {
      console.error('Onboarding update error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error',
        error: error.message
      });
    }
  };
  

  