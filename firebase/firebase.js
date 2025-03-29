// firebase/firebase.js
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// --- Load .env variables (Optional, for other settings if needed) ---
try {
  const dotenvPath = path.resolve(__dirname, '../.env'); // Assumes .env in project root
  if (fs.existsSync(dotenvPath)) {
    console.log(`Loading development environment variables from: ${dotenvPath}`);
    require('dotenv').config({ path: dotenvPath });
  } else {
    console.log('.env file not found, relying on specified secret file path or mocks.');
  }
} catch (err) {
  console.warn('Could not load .env file:', err.message);
}
// --- End .env loading ---

// --- Define paths for the service account file ---
const SERVICE_ACCOUNT_FILENAME = 'ecopulse.json'; // Matches your Railway Secret File setup
// 1. Path where Railway Secret Files service mounts the file (Checked FIRST)
const RAILWAY_SECRET_PATH = `/etc/secrets/${SERVICE_ACCOUNT_FILENAME}`;
// 2. Path in the project root directory (relative to this file's location) (Checked SECOND)
//    Adjust '../' if firebase.js is located differently relative to the project root.
const LOCAL_ROOT_PATH = path.resolve(__dirname, `../${SERVICE_ACCOUNT_FILENAME}`);
// --- End Path Definitions ---


// Guard against multiple initializations
if (!admin.apps.length) {
  let initialized = false;
  let initializationError = null;
  let serviceAccountPathUsed = null;
  let initMethod = 'None';

  console.log(`Attempting to initialize Firebase Admin SDK using service account file: ${SERVICE_ACCOUNT_FILENAME}`);

  try {
    // --- Strategy 1: Check Railway Secret File Path FIRST ---
    console.log(`Checking for Railway Secret File at: ${RAILWAY_SECRET_PATH}`);
    if (fs.existsSync(RAILWAY_SECRET_PATH)) {
      serviceAccountPathUsed = RAILWAY_SECRET_PATH;
      initMethod = `Platform Secret File (${RAILWAY_SECRET_PATH})`;
    }
    // --- Strategy 2: Check Local Root Path SECOND (if Railway path not found) ---
    else {
      console.log(`Railway Secret File not found. Checking for Local Root File at: ${LOCAL_ROOT_PATH}`);
      if (fs.existsSync(LOCAL_ROOT_PATH)) {
         // IMPORTANT: Ensure this local file is in .gitignore!
         console.warn(`Using local root file ${LOCAL_ROOT_PATH}. Ensure this file is in .gitignore and NOT committed.`);
        serviceAccountPathUsed = LOCAL_ROOT_PATH;
        initMethod = `Local Root File (${LOCAL_ROOT_PATH})`;
      } else {
        console.warn(`Service account file not found at expected paths:`);
        console.warn(` - Railway Path Checked: ${RAILWAY_SECRET_PATH}`);
        console.warn(` - Local Root Path Checked: ${LOCAL_ROOT_PATH}`);
        initializationError = new Error(`Service account file '${SERVICE_ACCOUNT_FILENAME}' not found.`);
      }
    }

    // If a valid path was determined, attempt initialization
    if (serviceAccountPathUsed) {
      console.log(`Found service account file. Attempting initialization using ${initMethod}...`);
      try {
        // Read and parse the JSON file content from the determined path
        const serviceAccountJson = fs.readFileSync(serviceAccountPathUsed, 'utf8');
        const serviceAccount = JSON.parse(serviceAccountJson);

        // Validate the content
        if (!serviceAccount.type || serviceAccount.type !== 'service_account' || !serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
          throw new Error(`Service account file content at ${serviceAccountPathUsed} is invalid or missing required fields.`);
        }

        // Initialize Firebase
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
          // Optionally add databaseURL: databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
        });

        console.log(`Firebase Admin initialized successfully using ${initMethod}.`);
        initialized = true;

      } catch (e) {
        console.error(`Error initializing from ${initMethod} (${serviceAccountPathUsed}):`, e.message);
        initializationError = initializationError || e; // Keep error if primary method fails
      }
    }

    // --- Mock Implementation (Fallback if initialization failed) ---
    if (!initialized) {
      initMethod = 'Mock Implementation';
      console.warn('--------------------------------------------------------------------');
      console.warn('WARNING: Firebase credentials failed to initialize or were not found!');
      console.warn(`Firebase Admin SDK is activating: ${initMethod}.`);
      // ... [ REST OF MOCK CODE GOES HERE - PASTE FROM PREVIOUS EXAMPLE ] ...
      const mockAuth = { createUser: async (userData) => { console.log('[MOCK] Auth: Creating Firebase user:', userData.email); return { uid: `mock-uid-${Date.now()}-${Math.random().toString(16).slice(2)}`, email: userData.email, emailVerified: false, displayName: userData.displayName || `Mock User ${uid.slice(-4)}` }; }, verifyIdToken: async (idToken, checkRevoked = false) => { console.log(`[MOCK] Auth: Simulating ID token verification (checkRevoked=${checkRevoked})`); if (!idToken || !idToken.startsWith('mock-token-')) throw new Error('[MOCK] Invalid mock token format.'); return { uid: 'mock-uid-verified', email: 'mock-verified@example.com', name: 'Mock Verified User', picture: '', auth_time: Math.floor(Date.now() / 1000) - 60, firebase: { sign_in_provider: 'custom' }, email_verified: true }; }, getUserByEmail: async (email) => { console.log(`[MOCK] Auth: Simulating get user by email: ${email}`); if (email === 'notfound@example.com' || !email) { const error = new Error(`[MOCK] There is no user record corresponding to the provided identifier (${email}).`); error.code = 'auth/user-not-found'; throw error; } return { uid: `mock-uid-email-${email.split('@')[0]}`, email: email, displayName: `Mock User for ${email}`, emailVerified: true }; }, getUser: async (uid) => { console.log(`[MOCK] Auth: Simulating get user by UID: ${uid}`); if (uid === 'notfound-uid' || !uid) { const error = new Error(`[MOCK] There is no user record corresponding to the provided identifier (${uid}).`); error.code = 'auth/user-not-found'; throw error; } return { uid: uid, email: `mock-get-${uid.slice(-4)}@example.com`, displayName: `Mock User ${uid.slice(-4)}`, customClaims: { mockRole: 'user' }, emailVerified: true }; }, setCustomUserClaims: async (uid, claims) => { console.log(`[MOCK] Auth: Simulating setting custom claims for UID ${uid}:`, claims || '(null)'); return; }, createCustomToken: async (uid, developerClaims) => { console.log(`[MOCK] Auth: Simulating custom token creation for UID ${uid} with claims:`, developerClaims || '(none)'); return `mock-custom-token.${Buffer.from(uid).toString('base64')}.${Buffer.from(JSON.stringify(developerClaims || {})).toString('base64')}.${Date.now()}`; }, updateUser: async (uid, properties) => { console.log(`[MOCK] Auth: Simulating user update for UID ${uid} with properties:`, properties); if (!uid) throw new Error('[MOCK] UID required for updateUser.'); return { uid: uid, email: properties.email || `mock-update-${uid.slice(-4)}@example.com`, displayName: properties.displayName || `Updated Mock User ${uid.slice(-4)}`, emailVerified: properties.emailVerified !== undefined ? properties.emailVerified : true, disabled: properties.disabled !== undefined ? properties.disabled : false }; }, deleteUser: async (uid) => { console.log(`[MOCK] Auth: Simulating deleting user ${uid}`); return; }, }; Object.defineProperty(admin, 'auth', { get: () => () => mockAuth, configurable: true }); const mockFirestoreDb = { collection: (collectionPath) => { const mockCollectionRef = { doc: (documentId) => { const docId = documentId || `mock-doc-autoid-${Date.now()}-${Math.random().toString(16).slice(2)}`; const mockDocRef = { id: docId, path: `${collectionPath}/${docId}`, parent: mockCollectionRef, get: async () => { const exists = !docId.includes('notfound'); const data = exists ? { mockField: `Data for ${docId}`, createdAt: new Date() } : undefined; return { id: docId, exists: exists, data: () => data, ref: mockDocRef, createTime: exists ? new Date(Date.now() - 10000) : undefined, updateTime: exists ? new Date(Date.now() - 5000) : undefined, readTime: new Date(), }; }, set: async (data, options) => { return { writeTime: new Date() }; }, update: async (data) => { return { writeTime: new Date() }; }, delete: async () => { return { writeTime: new Date() }; }, onSnapshot: (onNext, onError) => { const mockSnapshot = { id: docId, exists: true, data: () => ({ mockField: 'Realtime data for ' + docId }), ref: mockDocRef }; try { onNext(mockSnapshot); } catch (e) { console.error("[MOCK] onNext callback error:", e); if (onError) onError(e); } return () => {}; }, collection: (subCollectionPath) => mockFirestoreDb.collection(`${mockDocRef.path}/${subCollectionPath}`), }; return mockDocRef; }, add: async (data) => { const newId = `mock-added-doc-${Date.now()}-${Math.random().toString(16).slice(2)}`; return mockCollectionRef.doc(newId); }, where: (fieldPath, opStr, value) => { return mockCollectionRef; }, orderBy: (fieldPath, directionStr = 'asc') => { return mockCollectionRef; }, limit: (limit) => { return mockCollectionRef; }, get: async () => { const mockQuerySnapshot = { empty: true, docs: [], size: 0, query: mockCollectionRef, readTime: new Date(), forEach: (callback) => {}, }; return mockQuerySnapshot; }, onSnapshot: (onNext, onError) => { const mockEmptySnapshot = { empty: true, docs: [], size: 0, query: mockCollectionRef, readTime: new Date(), forEach: (cb) => {} }; try { onNext(mockEmptySnapshot); } catch (e) { console.error("[MOCK] onNext callback error:", e); if(onError) onError(e); } return () => {}; }, }; return mockCollectionRef; }, batch: () => { let operations = 0; const mockBatch = { set: (docRef, data, options) => { operations++; return mockBatch; }, update: (docRef, data) => { operations++; return mockBatch; }, delete: (docRef) => { operations++; return mockBatch; }, commit: async () => { return []; }, }; return mockBatch; }, }; Object.defineProperty(admin, 'firestore', { get: () => () => mockFirestoreDb, configurable: true });
       // --- END MOCK IMPLEMENTATIONS ---


      initialized = true; // Mark as "initialized" with mock
    }

  } catch (error) {
    console.error('CRITICAL ERROR during Firebase Admin SDK setup:', error);
    throw new Error(`Failed to initialize Firebase Admin SDK or its mock: ${error.message}`);
  }

} else {
  console.log('Firebase Admin SDK already initialized.');
}

module.exports = admin;