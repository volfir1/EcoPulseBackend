// firebase/firebase.js
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load .env variables from the root directory

// Check if any Firebase apps are already initialized
if (!admin.apps.length) {
  try {
    // STRATEGY 1: Try with individual environment variables (already in your .env)
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyEnv = process.env.FIREBASE_PRIVATE_KEY;
    
    if (projectId && clientEmail && privateKeyEnv) {
      console.log('Initializing Firebase with individual environment variables');
      
      // Handle private key line breaks properly
      const privateKey = privateKeyEnv.replace(/\\n/g, '\n');
      
      const serviceAccount = {
        projectId,
        client_email: clientEmail,
        private_key: privateKey
      };
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('Firebase Admin initialized successfully with environment variables');
    } 
    // STRATEGY 2: Try with service account JSON in environment variable
    else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('Initializing Firebase with FIREBASE_SERVICE_ACCOUNT JSON');
      const serviceAccountFromEnv = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountFromEnv)
      });
      
      console.log('Firebase Admin initialized successfully from FIREBASE_SERVICE_ACCOUNT');
    }
    // STRATEGY 3: Try with local service account file
    else {
      const serviceAccountPath = path.resolve(__dirname, './ecopulse.json');
      
      if (fs.existsSync(serviceAccountPath)) {
        console.log('Loading Firebase service account from local file');
        const serviceAccount = require('./ecopulse.json');
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        
        console.log('Firebase Admin initialized successfully from local file');
      } 
      // STRATEGY 4: Try with Render secret files location
      else {
        const renderSecretPath = '/etc/secrets/firebase-credentials.json';
        if (fs.existsSync(renderSecretPath)) {
          console.log('Loading Firebase service account from Render secret file');
          const serviceAccount = require(renderSecretPath);
          
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
          
          console.log('Firebase Admin initialized successfully from Render secret');
        }
        // FALLBACK: Mock implementation
        else {
          console.warn('Firebase credentials not found. Creating mock implementation.');
          
          // Enhanced mock auth implementation
          const mockAuth = {
            createUser: async (userData) => {
              console.log('MOCK: Creating Firebase user', userData.email);
              return { 
                uid: `mock-${Date.now()}`, 
                email: userData.email,
                emailVerified: false,
                displayName: userData.displayName || null
              };
            },
            verifyIdToken: async (token) => {
              console.log('MOCK: Verifying Firebase token', token?.substring(0, 10) + '...');
              return { 
                uid: 'mock-uid', 
                email: 'mock@example.com',
                email_verified: true
              };
            },
            getUserByEmail: async (email) => {
              console.log('MOCK: Getting user by email', email);
              return { 
                uid: 'mock-uid', 
                email,
                emailVerified: true,
                displayName: 'Mock User'
              };
            },
            updateUser: async (uid, userData) => {
              console.log('MOCK: Updating user', uid, userData);
              return {
                uid,
                ...userData,
                emailVerified: userData.emailVerified || false
              };
            },
            getUser: async (uid) => {
              console.log('MOCK: Getting user by ID', uid);
              return {
                uid,
                email: `mock-${uid}@example.com`,
                emailVerified: true
              };
            },
            deleteUser: async (uid) => {
              console.log('MOCK: Deleting user', uid);
              return true;
            }
          };
          
          // Replace the auth method with our mock
          admin.auth = () => mockAuth;
          
          console.log('Mock Firebase implementation ready');
        }
      }
    }
  } catch (error) {
    console.error('Firebase admin initialization error:', error.stack);
    
    // Create emergency mock implementation
    const emergencyMockAuth = {
      createUser: async (userData) => {
        console.log('EMERGENCY MOCK: Creating Firebase user', userData.email);
        return { uid: `emergency-${Date.now()}`, email: userData.email };
      },
      verifyIdToken: async (token) => {
        console.log('EMERGENCY MOCK: Verifying Firebase token');
        return { uid: 'emergency-uid', email: 'emergency@example.com' };
      },
      getUserByEmail: async (email) => {
        console.log('EMERGENCY MOCK: Getting user by email', email);
        return { uid: 'emergency-uid', email };
      }
    };
    
    // Replace the auth method with our emergency mock
    admin.auth = () => emergencyMockAuth;
    
    console.log('Emergency mock Firebase implementation ready');
  }
} else {
  console.log('Firebase Admin SDK already initialized');
}

module.exports = admin;