// scripts/deactUser.js
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

/**
 * Script to test deactivation for a specific user
 * 
 * Run this script with: node scripts/deactUser.js
 */

// User ID to deactivate
const userId = '67d921866b80bc0b3c28fd51'; // John Martin's ID
const userEmail = 'lester.sible@tup.edu.ph';

// Print environment variables for debugging (don't include sensitive info in logs)
console.log('Environment variables loaded:', {
  MONGO_URI_EXISTS: !!process.env.MONGO_URI,
  NODE_ENV: process.env.NODE_ENV
});

// You may need to hardcode your MongoDB connection string if .env isn't working
// IMPORTANT: Replace this with your actual MongoDB connection string
// For development purposes only - avoid hardcoding credentials in production code
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:5000/api';

async function deactivateSpecificUser() {
  try {
    console.log('Starting test deactivation process...');
    console.log(`Attempting to deactivate user: ${userEmail} (ID: ${userId})`);
    
    console.log('Connecting to MongoDB with URI:', 
      MONGO_URI.substring(0, 10) + '...' // Only show part of the URI for security
    );
    
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    
    console.log('MongoDB connected successfully');
    
    // Create a valid ObjectId
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(userId);
      console.log(`Created ObjectId: ${objectId}`);
    } catch (err) {
      console.error('Invalid ObjectId format:', err);
      return;
    }
    
    // Access the users collection
    const db = mongoose.connection.db;
    console.log('Database accessed, collections:', await db.listCollections().toArray());
    
    const usersCollection = db.collection('users');
    console.log('Accessed users collection');
    
    // Find the user
    const user = await usersCollection.findOne({ _id: objectId });
    
    if (!user) {
      console.error(`User not found with ID: ${userId}`);
      return;
    }
    
    console.log('User found:', {
      id: user._id.toString(),
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      isAutoDeactivated: user.isAutoDeactivated
    });
    
    // Generate a reactivation token
    const reactivationToken = crypto.randomBytes(32).toString('hex');
    
    // Set token expiration (90 days from now)
    const tokenExpires = new Date();
    tokenExpires.setDate(tokenExpires.getDate() + 90);
    
    console.log('Updating user to deactivated status...');
    
    // Update the user document
    const updateResult = await usersCollection.updateOne(
      { _id: objectId },
      {
        $set: {
          isAutoDeactivated: true,
          autoDeactivatedAt: new Date(),
          reactivationToken: reactivationToken,
          reactivationTokenExpires: tokenExpires,
          reactivationAttempts: 0,
          lastActivity: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        }
      }
    );
    
    console.log('Update result:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount
    });
    
    if (updateResult.modifiedCount > 0) {
      console.log('User successfully deactivated!');
      console.log('Reactivation token:', reactivationToken);
      console.log('Reactivation URL:', `/reactivate-account?token=${reactivationToken}`);
    } else {
      console.log('No changes were made to the user');
    }
    
  } catch (error) {
    console.error('Error in deactivation process:', error);
  } finally {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
      }
    } catch (err) {
      console.error('Error closing MongoDB connection:', err);
    }
  }
}

// Run the function
deactivateSpecificUser()
  .then(() => {
    console.log('Script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  });