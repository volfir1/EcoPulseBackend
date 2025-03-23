// middleware/cors.js
const cors = require('cors');

/**
 * Enhanced CORS middleware configuration for Vercel deployment
 * Handles development and production environments with secure defaults
 */
const setupCors = (app) => {
  // Get environment variables
  const NODE_ENV = process.env.NODE_ENV || 'development';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5000';
  
  // Parse comma-separated origins from environment variable if available
  const CORS_ORIGINS = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : [];
  
  // Default allowed origins (always include the frontend URL)
  const allowedOrigins = [
    FRONTEND_URL,
    // Include production domains
    'https://your-app.vercel.app',
    'https://your-custom-domain.com',
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
      // Allow requests with no origin (like mobile apps, Postman, etc)
      if (!origin) {
        console.log('Request has no origin, allowing');
        return callback(null, true);
      }
      
      if (allowedOrigins.indexOf(origin) !== -1 || NODE_ENV === 'development') {
        console.log(`Origin ${origin} is allowed`);
        callback(null, true);
      } else {
        console.log(`Origin ${origin} is not allowed by CORS`);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
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