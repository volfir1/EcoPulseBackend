// script/autoDeactivateUsers.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const { sendAutoDeactivationEmail } = require('../utils/emailService');
require('dotenv').config();

/**
 * Script to automatically deactivate user accounts that have been inactive
 * for 30 days or more.
 * 
 * Run this script with: node script/autoDeactivateUsers.js
 */

// Database connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

async function deactivateInactiveAccounts() {
  try {
    console.log('Starting auto-deactivation process...');
    
    // Calculate the date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    console.log(`Finding accounts with no activity since: ${thirtyDaysAgo.toISOString()}`);
    
    // Use the direct MongoDB connection for maximum control
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Find users who haven't been active in 30+ days and aren't already deactivated
    const inactiveUsers = await usersCollection.find({
      lastActivity: { $lt: thirtyDaysAgo },
      isAutoDeactivated: { $ne: true },
      isDeactivated: { $ne: true }
    }).toArray();
    
    console.log(`Found ${inactiveUsers.length} inactive accounts to deactivate`);
    
    // Process each inactive user
    for (const user of inactiveUsers) {
      console.log(`Processing user: ${user.email} (ID: ${user._id})`);
      
      // Generate a reactivation token
      const reactivationToken = crypto.randomBytes(32).toString('hex');
      
      // Set token expiration (90 days from now)
      const tokenExpires = new Date();
      tokenExpires.setDate(tokenExpires.getDate() + 90);
      
      // Update the user document to mark as auto-deactivated
      const updateResult = await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            isAutoDeactivated: true,
            autoDeactivatedAt: new Date(),
            reactivationToken: reactivationToken,
            reactivationTokenExpires: tokenExpires,
            reactivationAttempts: 0
          }
        }
      );
      
      console.log(`Update result for ${user.email}:`, {
        matchedCount: updateResult.matchedCount,
        modifiedCount: updateResult.modifiedCount
      });
      
      // Only send email if the update was successful
      if (updateResult.modifiedCount > 0) {
        try {
          // Create user object for email service
          const userForEmail = {
            _id: user._id,
            email: user.email,
            firstName: user.firstName || '',
            lastName: user.lastName || ''
          };
          
          // Send deactivation notification email
          await sendAutoDeactivationEmail(userForEmail, reactivationToken);
          console.log(`Deactivation email sent to ${user.email}`);
        } catch (emailError) {
          console.error(`Error sending deactivation email to ${user.email}:`, emailError);
        }
      }
    }
    
    console.log('Auto-deactivation process completed');
    
  } catch (error) {
    console.error('Error in auto-deactivation process:', error);
  } finally {
    // Close the MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Execute the function
deactivateInactiveAccounts()
  .then(() => {
    console.log('Script execution completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Script execution failed:', err);
    process.exit(1);
  });