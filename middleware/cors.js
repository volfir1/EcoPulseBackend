const cors = require('cors');

/**
 * Enhanced CORS middleware configuration for Vercel deployment
 * Handles development and production environments with secure defaults
 */
const setupCors = (app) => {
  // Get environment variables
  const NODE_ENV = process.env.NODE_ENV || 'development'; 
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Parse comma-separated origins from environment variable if available
  const CORS_ORIGINS = process.env.ALLOWED_ORIGINS
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
    'http://localhost:3000',
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
      
      // // Always allow the main frontend URL (highest priority)
      // if (origin === 'https://eco-pulse-final.vercel.app') {
      //   console.log("✅ Frontend allowed:", origin);
      //   return callback(null, true);
      // }
      
      // Allow any eco-pulse-final Vercel deployments with regex pattern matching
      if (origin.match(/https:\/\/(.*\.)?eco-pulse-final(-git-[\w-]+)?\.vercel\.app/)) {
        console.log("✅ Allowed Vercel deployment:", origin);
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
      'Cache-Control',
      'Cookie',
      'X-API-Key'
    ],
    exposedHeaders: ['Content-Length', 'X-Total-Count', 'X-New-Token'],
    maxAge: 86400 // Cache preflight request results for 24 hours (in seconds)
  };
  
  // Apply CORS middleware with our custom options
  app.use(cors(corsOptions));
  
  // Store allowed origins in res.locals for debug endpoint
  app.use((req, res, next) => {
    res.locals.allowedOrigins = allowedOrigins;
    next();
  });
  
  // Handle specific preflight for the problematic endpoint
  app.options('/api/auth/check-account-status', (req, res) => {
    const origin = req.headers.origin;
    
    // Set appropriate headers for all origins
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    // Log the headers we're sending
    console.log('Sending CORS headers for check-account-status:', {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });
    
    res.sendStatus(204);
  });
  
  // Handle auth check route explicitly - as a fallback
  app.use('/api/auth/check-account-status', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });
  
  // Handle direct route access too (in case you have both routes)
  app.options('/auth/check-account-status', (req, res) => {
    const origin = req.headers.origin;
    
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    res.sendStatus(204);
  });
  
  console.log('CORS middleware configured successfully');
};

module.exports = setupCors;