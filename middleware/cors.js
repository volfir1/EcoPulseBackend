const cors = require('cors');

/**
 * Enhanced CORS middleware configuration for Vercel deployment
 * Handles development and production environments with secure defaults
 * @param {Express} app - Express application instance
 */
const setupCors = (app) => {
  // Get environment variables with defaults
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const MOBILE_URL = process.env.MOBILE_URL || 'http://192.168.1.2:8081';

  // Parse comma-separated origins from environment variable
  const CORS_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [];

  // Build allowed origins list
  const allowedOrigins = [
    FRONTEND_URL,
    MOBILE_URL,
    // Mobile app development URLs
    'ecopulse://expo-development-client',
    'http://192.168.1.2:8081',
    // Vercel deployments - UPDATED to include both domain patterns
    'https://ecopulse-delta.vercel.app',
    'https://ecopulse-alpha.vercel.app',
    // Railway backend

    // Render backend
    'https://ecopulsebackend-1.onrender.com',
    'https://ecopulsebackend.onrender.com',
    // Local development
    'http://localhost:8000',
    'http://localhost:8081',
    'http://localhost:5000',
    'http://127.0.0.1:8000',
    'http://localhost:5173',
    'http://localhost:3000',
    'exp://192.168.1.2:8081',
    'http://127.0.0.1:8000',
    'http://192.168.1.2:5000',  
    ...CORS_ORIGINS
  ];

  console.log(`Setting up CORS for ${NODE_ENV} environment`);
  console.log('Allowed origins:', allowedOrigins);

  // CORS configuration options
  const corsOptions = {
    origin: function(origin, callback) {
      // Debug logging
      console.log(`CORS request from: ${origin || 'No origin (e.g. Mobile app, Postman, curl)'}`);

      // Allow requests with no origin (like mobile apps, Postman, etc)
      if (!origin) {
        console.log('Request has no origin, allowing (likely a mobile app request)');
        return callback(null, true);
      }

      // Check for Expo/React Native deep link scheme
      if (origin.startsWith('ecopulse://') || origin.startsWith('exp://')) {
        console.log("✅ Allowed Expo/React Native origin:", origin);
        return callback(null, true);
      }

      // Update the regex to match both domain patterns
      if (origin.match(/https:\/\/(.*\.)?eco-pulse-final(-git-[\w-]+)?\.vercel\.app/) ||
          origin.match(/https:\/\/(.*\.)?ecopulse-delta(-git-[\w-]+)?\.vercel\.app/)) {
        console.log("✅ Allowed Vercel deployment:", origin);
        return callback(null, true);
      }

      // Check against explicit allowed origins list
      if (allowedOrigins.includes(origin)) {
        console.log(`✅ Origin ${origin} is explicitly allowed`);
        return callback(null, true);
      }

      // In development, allow all origins
      if (NODE_ENV === 'development') {
        console.log(`✅ Allowing all origins in development mode`);
        return callback(null, true);
      }

      // Reject all other origins in production
      console.log(`🚫 Origin ${origin} is not allowed by CORS`);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true, // Allow cookies and credentials
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cache-Control',
      'Cookie',
      'X-API-Key',
      'x-client-type',
      'expo-platform',
      'expo-version'
    ],
    exposedHeaders: ['Content-Length', 'X-Total-Count', 'X-New-Token'],
    maxAge: 86400 // Cache preflight request results for 24 hours (in seconds)
  };

  // Apply general CORS middleware
  app.use(cors(corsOptions));

  // Handle ALL OPTIONS requests broadly with proper CORS headers
  app.options('*', (req, res) => {
    const origin = req.headers.origin;

    // Allow the origin if it's in our allowed list or we're in development
    let allowOrigin = '*';
    if (origin) {
      if (allowedOrigins.includes(origin) ||
          origin.match(/https:\/\/(.*\.)?eco-pulse-final(-git-[\w-]+)?\.vercel\.app/) ||
          origin.match(/https:\/\/(.*\.)?ecopulse-delta(-git-[\w-]+)?\.vercel\.app/) ||
          origin.startsWith('ecopulse://') ||
          origin.startsWith('exp://') ||
          NODE_ENV === 'development') {
        allowOrigin = origin;
      }
    }

    // IMPORTANT: Set all required CORS headers
    res.header('Access-Control-Allow-Origin', allowOrigin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key, x-client-type, expo-platform, expo-version');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');

    console.log(`OPTIONS request from ${origin || 'unknown/mobile'} to ${req.path} - responded with CORS headers`);

    // End preflight request successfully
    res.status(204).end();
  });

  // Special handling for problematic endpoints
  app.options('/api/auth/check-account-status', (req, res) => {
    const origin = req.headers.origin;

    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key, x-client-type, expo-platform, expo-version');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');

    console.log('Sending CORS headers for /api/auth/check-account-status');

    res.sendStatus(204);
  });

  // Also handle /auth/check-account-status (without /api prefix)
  app.options('/auth/check-account-status', (req, res) => {
    const origin = req.headers.origin;

    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key, x-client-type, expo-platform, expo-version');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');

    console.log('Sending CORS headers for /auth/check-account-status');

    res.sendStatus(204);
  });

  // Store allowed origins in res.locals for debugging
  app.use((req, res, next) => {
    res.locals.allowedOrigins = allowedOrigins;
    next();
  });

  console.log('CORS middleware configured successfully');
};

module.exports = setupCors;