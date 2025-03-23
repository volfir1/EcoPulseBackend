// complete-user-seeder.js - Enhanced version without inactive users
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected for seeding'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const User = require('./models/User');

// Configuration constants
const SEED_CONFIG = {
  totalUsers: 55,
  adminCount: 5,
  password: 'Admin@123'
};

// Helper functions
const randomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const getRandomItem = (array) => array[Math.floor(Math.random() * array.length)];

// Main seeder function
const seedUsers = async () => {
  try {
    console.log('🔍 Checking for existing users before seeding...');
    
    // Get count of all existing users for statistics
    const totalExistingUserCount = await User.countDocuments({});
    console.log(`Found ${totalExistingUserCount} total users in database`);
    
    // Cleanup previous seeded data - now using a special flag
    // First, add the 'isSeeded' flag to all existing seeded users that don't have it
    // This is for backwards compatibility with your previous seeder versions
    await User.updateMany(
      { email: { $regex: /@gmail\.com$/ }, isSeeded: { $ne: true } },
      { $set: { isSeeded: true } }
    );
    
    // Now delete all users marked as seeded
    const deletedUsers = await User.deleteMany({ isSeeded: true });
    console.log(`Cleared ${deletedUsers.deletedCount} previously seeded users`);

    // Seed new data
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    // Sample name arrays
    const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 
                        'Robert', 'Lisa', 'William', 'Jessica', 'James', 'Jennifer',
                        'Joseph', 'Amanda', 'Charles', 'Ashley', 'Thomas', 'Megan',
                        'Daniel', 'Elizabeth'];
                        
    const lastNames = ['Smith', 'Johnson', 'Brown', 'Jones', 'Miller', 'Davis', 
                      'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin',
                      'Jackson', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis',
                      'Robinson', 'Walker'];

    const genders = ['male', 'female', 'prefer-not-to-say'];
    
    // User creation counter
    let createdUsers = 0;

    for(let i = 0; i < SEED_CONFIG.totalUsers; i++) {
      const isAdmin = i < SEED_CONFIG.adminCount;
      const firstName = getRandomItem(firstNames);
      const lastName = getRandomItem(lastNames);
      const gender = getRandomItem(genders);
      
      const user = new User({
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 1000)}@gmail.com`,
        password: await bcrypt.hash(SEED_CONFIG.password, await bcrypt.genSalt(10)),
        gender,
        role: isAdmin ? 'admin' : 'user',
        isVerified: true,
        avatar: `avatar-${Math.floor(Math.random() * 8) + 1}`, // Assuming you have avatar-1 through avatar-8
        lastLogin: randomDate(sixMonthsAgo, now),
        lastActivity: randomDate(sixMonthsAgo, now),
        createdAt: randomDate(sixMonthsAgo, now),
        isSeeded: true // This is the special flag to mark seeded users
      });

      await user.save();
      createdUsers++;
      
      // The code that set some users as inactive/auto-deactivated has been removed
    }
    
    // Count non-seeded users (real users)
    const manualUserCount = await User.countDocuments({ isSeeded: { $ne: true } });

    console.log(`\n✅ Successfully created ${createdUsers} seeded users!`);
    console.log(`- Including ${SEED_CONFIG.adminCount} admin users`);
    console.log(`- Your database now has ${manualUserCount} real (manually registered) users`);
    console.log(`- Total users in database: ${manualUserCount + createdUsers}`);
    console.log('- All seeded users are active (no auto-deactivated users)');

    mongoose.disconnect();
    console.log('Database connection closed.');
  } catch(error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedUsers();