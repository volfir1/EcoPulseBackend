// middleware/cors.js
const cors = require('cors');

/**
 * Enhanced CORS middleware configuration for Vercel deployment
 * Handles development and production environments with secure defaults
 */
const setupCors = (app) => {
  // Get environment variables
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const FRONTEND_URL = process.env.PY_URL || 'http://localhost:5000';
  
  // Parse comma-separated origins from environment variable if available
  const CORS_ORIGINS = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : [];
  
  // Default allowed origins (always include the frontend URL)
  const allowedOrigins = [
    FRONTEND_URL,
    // Include production domains
    'https://eco-pulse-final.vercel.app',
    'https://ecopulse.up.railway.app',
    'https://ecopulsebackend-production.up.railway.app',
    // Include development domains
    'http://localhost:8000',
    'http://localhost:5173',
    ...CORS_ORIGINS // Add any additional origins from env vars
  ];
  
  console.log(`Setting up CORS for ${NODE_ENV} environment`);
  console.log('Allowed origins:', allowedOrigins);
  
  // CORS configuration
  const corsOptions = {
    origin: function(origin, callback) {
      // Debug logging for all requests
      console.log(`CORS request from: ${origin || 'No origin (e.g. Postman, curl)'}`);
      
      // Allow requests with no origin (like mobile apps, Postman, etc)
      if (!origin) {
        console.log('Request has no origin, allowing');
        return callback(null, true);
      }
      
      // Allow any eco-pulse-final Vercel deployments with regex pattern matching
      if (origin.match(/https:\/\/eco-pulse-final[^.]*\.vercel\.app/)) {
        console.log("✅ Allowed Vercel deployment:", origin);
        return callback(null, true);
      }
      
      // Allow access from Railway backend
      if (origin.includes('ecopulsebackend-production.up.railway.app')) {
        console.log("✅ Allowed Railway backend:", origin);
        return callback(null, true);
      }
      
      // Check against explicit allowed origins list
      if (allowedOrigins.indexOf(origin) !== -1) {
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
      'Cache-Control'
    ],
    exposedHeaders: ['Content-Length', 'X-Total-Count'],
    maxAge: 86400 // Cache preflight request results for 24 hours (in seconds)
  };
  
  // Apply CORS middleware with our custom options
  app.use(cors(corsOptions));
  
  // Handle preflight OPTIONS requests explicitly
  app.options('*', cors(corsOptions));
  
  console.log('CORS middleware configured successfully');
};

module.exports = setupCors;