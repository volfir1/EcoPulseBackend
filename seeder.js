const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGO_URL = process.env.MONGO_URL;

mongoose.connect(MONGO_URL)
  .then(() => console.log('MongoDB connected for seeding'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const User = require('./models/User');

// Configuration constants
const SEED_CONFIG = {
  totalUsers: 100,
  adminCount: 5,
  password: 'Admin@123'
};

// Helper functions
const randomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const getRandomItem = (array) => array[Math.floor(Math.random() * array.length)];

// Generate unique visits for each user
const generateUniqueVisits = (userIndex) => {
  const visits = {};
  const now = new Date();
  const baseVisits = [42, 38, 31, 45, 33, 29]; // Different base numbers for each month
  
  for (let i = 0; i < 6; i++) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7);
    visits[month] = baseVisits[i] + (userIndex % 15) + Math.floor(userIndex / 3);
  }
  return visits;
};

// Special visit patterns for famous players
const generateFamousPlayerVisits = (playerName, index) => {
  const visits = {};
  const now = new Date();
  
  let baseVisits;
  if (playerName === 'Lionel Messi') {
    baseVisits = [287, 312, 298, 323, 275, 342]; // Messi's pattern
  } else if (playerName === 'Cristiano Ronaldo') {
    baseVisits = [305, 278, 331, 289, 347, 293]; // Ronaldo's pattern
  } else {
    baseVisits = [185, 163, 172, 156, 194, 178];
  }
  
  for (let i = 0; i < 6; i++) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7);
    visits[month] = baseVisits[i] + (index * 3) + Math.floor(Math.random() * 10);
  }
  return visits;
};

// Diverse name collections from different cultures
const nameCollections = {
  // Filipino names
  filipino: {
    firstNames: ['Juan', 'Maria', 'Jose', 'Andres', 'Miguel', 'Rosa', 'Eduardo', 'Sofia', 'Rafael', 'Gabriela', 'Manuel', 'Isabella', 'Paolo', 'Jasmine', 'Angelo'],
    lastNames: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Gonzales', 'De Leon', 'Mendoza', 'Ramos', 'Aquino', 'Garcia', 'Diaz', 'Mercado', 'Del Rosario', 'Villanueva', 'Hernandez']
  },
  
  // Chinese names
  chinese: {
    firstNames: ['Wei', 'Jing', 'Ming', 'Hui', 'Xin', 'Li', 'Yong', 'Tao', 'Yang', 'Yan', 'Fei', 'Ying', 'Chen', 'Jun', 'Hong'],
    lastNames: ['Zhang', 'Wang', 'Li', 'Chen', 'Liu', 'Yang', 'Huang', 'Wu', 'Zhou', 'Zhu', 'Lin', 'Sun', 'Ma', 'Gao', 'Xu']
  },
  
  // Russian names
  russian: {
    firstNames: ['Vladimir', 'Sergei', 'Dmitri', 'Ivan', 'Alexander', 'Anastasia', 'Tatiana', 'Olga', 'Natalia', 'Elena', 'Mikhail', 'Andrei', 'Yuri', 'Nikolai', 'Ekaterina'],
    lastNames: ['Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Popov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov', 'Volkov', 'Romanov', 'Makarov', 'Fedorov', 'Golubev']
  },
  
  // Japanese names
  japanese: {
    firstNames: ['Haruto', 'Yuto', 'Sota', 'Yuki', 'Riku', 'Yui', 'Aoi', 'Hina', 'Rin', 'Saki', 'Kaito', 'Takumi', 'Hinata', 'Mei', 'Akira'],
    lastNames: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto']
  },
  
  // European names
  european: {
    firstNames: ['Emma', 'Noah', 'Olivia', 'Liam', 'Sophia', 'Lucas', 'Charlotte', 'Leon', 'Mia', 'Oscar', 'Emilia', 'Luis', 'Sofia', 'Antoine', 'Isabella'],
    lastNames: ['Schmidt', 'Müller', 'García', 'Rossi', 'Bernard', 'Dubois', 'Nielsen', 'Andersson', 'Papadopoulos', 'Kowalski', 'Jansen', 'Martínez', 'Peeters', 'Bianchi', 'Kos']
  },
  
  // African names
  african: {
    firstNames: ['Kwame', 'Ama', 'Kofi', 'Abena', 'Adebayo', 'Chipo', 'Tendai', 'Amara', 'Sefu', 'Zola', 'Thabo', 'Nia', 'Mandla', 'Amina', 'Koffi'],
    lastNames: ['Mensah', 'Okafor', 'Mwangi', 'Diallo', 'Nkosi', 'Osei', 'Abara', 'Dlamini', 'Ibrahim', 'Chukwu', 'Banda', 'Afolayan', 'Nwosu', 'Okeke', 'Musa']
  },
  
  // Middle Eastern names
  middleEastern: {
    firstNames: ['Ahmed', 'Fatima', 'Mohammed', 'Zahra', 'Ali', 'Leila', 'Omar', 'Yasmin', 'Hassan', 'Amir', 'Rania', 'Ibrahim', 'Zainab', 'Yusuf', 'Sara'],
    lastNames: ['Al-Farsi', 'Khan', 'Rahman', 'Al-Mansour', 'Amir', 'Najjar', 'Hassan', 'Hakim', 'Malik', 'Al-Sharif', 'Saleh', 'Karimi', 'Aziz', 'Hanif', 'Al-Sayed']
  }
};

// Function to get diverse name
const getDiverseName = (index) => {
  // Cycle through cultures based on index to ensure diversity
  const cultures = Object.keys(nameCollections);
  const culture = cultures[index % cultures.length];
  
  const firstName = getRandomItem(nameCollections[culture].firstNames);
  const lastName = getRandomItem(nameCollections[culture].lastNames);
  
  return { firstName, lastName, culture };
};

const seedUsers = async () => {
  try {
    console.log('🔍 Checking for existing users before seeding...');
    
    // Get count of real user accounts (not seeded)
    const realUserCount = await User.countDocuments({ isSeeded: { $ne: true } });
    console.log(`Found ${realUserCount} real user accounts (these will be preserved).`);
    
    // Get existing seeded users
    const existingSeededUsers = await User.find({ isSeeded: true });
    console.log(`Found ${existingSeededUsers.length} previously seeded users.`);

    // Delete all existing seeded users to start fresh
    if (existingSeededUsers.length > 0) {
      await User.deleteMany({ isSeeded: true });
      console.log('Removed existing seeded users to create fresh data.');
    }

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    
    const genders = ['male', 'female', 'prefer-not-to-say'];

    // Famous players - add Messi and Ronaldo at the beginning
    const famousPlayers = [
      'Lionel Messi',      // Added Messi
      'Cristiano Ronaldo', // Added Ronaldo
      'LeBron James', 
      'Stephen Curry', 
      'Kevin Durant', 
      'Giannis Antetokounmpo',
      'Luka Doncic', 
      'Nikola Jokic', 
      'Joel Embiid', 
      'Jayson Tatum',
      'Jimmy Butler', 
      'Kawhi Leonard',
      'Max Verstappen'
    ];
    
    // Create the 100 seeded users, starting with famous players
    let createdUsers = 0;
    const batchSize = 10; // Process in batches to avoid memory issues
    const usersToCreate = SEED_CONFIG.totalUsers;
    
    console.log(`Creating ${usersToCreate} seeded users...`);
    
    // First create the famous players (including Messi and Ronaldo)
    for (let i = 0; i < famousPlayers.length && createdUsers < usersToCreate; i++) {
      const [firstName, lastName] = famousPlayers[i].split(' ');
      const playerName = famousPlayers[i];
      
      const user = new User({
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@ecopulse.example`,
        password: await bcrypt.hash(SEED_CONFIG.password, 10),
        gender: 'male',
        role: i < SEED_CONFIG.adminCount ? 'admin' : 'user',
        isVerified: true,
        avatar: `avatar-${Math.floor(Math.random() * 8) + 1}`,
        lastLogin: randomDate(sixMonthsAgo, now),
        lastActivity: randomDate(new Date(now - 1000*60*60*24*7), now), // Last 7 days
        createdAt: randomDate(new Date(sixMonthsAgo.getTime() - 90*24*60*60*1000), sixMonthsAgo),
        visits: generateFamousPlayerVisits(playerName, i),
        isSeeded: true
      });

      await user.save();
      createdUsers++;
    }
    
    // Then fill the rest with diverse users, each with unique visit patterns
    for (let i = createdUsers; i < usersToCreate; i++) {
      const isAdmin = i < SEED_CONFIG.adminCount;
      const { firstName, lastName, culture } = getDiverseName(i);
      const gender = getRandomItem(genders);
      
      // Create a unique but realistic email
      const emailDomain = i % 3 === 0 ? 'gmail.com' : 
                          i % 3 === 1 ? 'outlook.com' : 'yahoo.com';
      
      const user = new User({
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 100)}@${emailDomain}`,
        password: await bcrypt.hash(SEED_CONFIG.password, 10),
        gender,
        role: isAdmin ? 'admin' : 'user',
        isVerified: true,
        avatar: `avatar-${Math.floor(Math.random() * 8) + 1}`,
        lastLogin: randomDate(sixMonthsAgo, now),
        lastActivity: randomDate(sixMonthsAgo, now),
        createdAt: randomDate(sixMonthsAgo, now),
        visits: generateUniqueVisits(i), // Unique visit pattern based on index
        isSeeded: true,
        culture: culture // Save culture info for reference
      });

      await user.save();
      createdUsers++;
      
      // Log progress in batches
      if (createdUsers % batchSize === 0 || createdUsers === usersToCreate) {
        console.log(`Progress: ${createdUsers}/${usersToCreate} users created`);
      }
    }
    
    // Count users by culture
    const culturesUsed = {};
    const seededUsers = await User.find({ isSeeded: true });
    seededUsers.forEach(user => {
      if (user.culture) {
        culturesUsed[user.culture] = (culturesUsed[user.culture] || 0) + 1;
      }
    });
    
    console.log(`✅ Successfully added ${createdUsers} seeded users with diverse names!`);
    console.log(`- Including Lionel Messi and Cristiano Ronaldo with 275-347 visits/month`);
    console.log(`- Including ${SEED_CONFIG.adminCount} admin users`);
    console.log(`- Cultures represented: ${Object.keys(nameCollections).join(', ')}`);
    console.log(`- Total users in database now: ${await User.countDocuments({})}`);
    
    mongoose.disconnect();
    console.log('Database connection closed.');
  } catch (error) {
    console.error('Seeding error:', error);
    mongoose.disconnect();
    process.exit(1);
  }
};

seedUsers();