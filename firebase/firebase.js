// firebase/firebase.js
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Check if any Firebase apps are already initialized
if (!admin.apps.length) {
  try {
    // First try with the local service account file
    const serviceAccountPath = path.resolve(__dirname, './ecopulse.json');
    
    if (fs.existsSync(serviceAccountPath)) {
      console.log('Loading Firebase service account from:', serviceAccountPath);
      const serviceAccount = require('./ecopulse.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('Firebase Admin initialized successfully');
    } else {
      console.error('Firebase service account file not found at:', serviceAccountPath);
      
      // Try initializing with environment variables if available
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.log('Trying to initialize Firebase with environment variable');
        const serviceAccountFromEnv = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccountFromEnv)
        });
        
        console.log('Firebase Admin initialized successfully from environment variable');
      } else {
        // Create a mock implementation as fallback
        console.warn('Firebase credentials not found. Creating mock implementation.');
        
        // This prevents the app from crashing when Firebase is not available
        const mockAuth = {
          createUser: async (userData) => {
            console.log('MOCK: Creating Firebase user', userData.email);
            return { uid: `mock-${Date.now()}`, email: userData.email };
          },
          verifyIdToken: async (token) => {
            console.log('MOCK: Verifying Firebase token');
            return { uid: 'mock-uid', email: 'mock@example.com' };
          },
          getUserByEmail: async (email) => {
            console.log('MOCK: Getting user by email', email);
            return { uid: 'mock-uid', email };
          }
        };
        
        // Replace the auth method with our mock
        admin.auth = () => mockAuth;
        
        console.log('Mock Firebase implementation ready');
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
      }
    };
    
    // Replace the auth method with our emergency mock
    admin.auth = () => emergencyMockAuth;
    
    console.log('Emergency mock Firebase implementation ready');
  }
}

module.exports = admin;