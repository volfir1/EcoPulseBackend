const express = require("express");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const compression = require('compression');
const setupCors = require('./middleware/cors');

// Route imports
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

// Create Express app
const app = express();  

// Enable compression
app.use(compression());

// Apply the CORS configuration from cors.js middleware
setupCors(app);

// Create a reusable CORS handler for specific routes
const applySpecificCors = (req, res, next) => {
  const origin = req.headers.origin;
  
  // Set headers explicitly for this route
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  // For OPTIONS requests, send immediate success
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Cookie, X-API-Key');
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  
  next();
};

// Apply the specific CORS handler to problematic routes
app.use('/api/auth/check-account-status', applySpecificCors);
app.use('/auth/check-account-status', applySpecificCors);

// Enhanced debug logging middleware
app.use((req, res, next) => {
  // Skip logging for static files
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico)$/)) {
    return next();
  }
  
  const requestStart = Date.now();
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin || 'No origin');
  
  // Track response completion with timing
  res.on('finish', () => {
    const duration = Date.now() - requestStart;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Body parsing middleware
app.use(cookieParser());
app.use(express.json({
  limit: '50mb',
  parameterLimit: 50000,
  extended: true
}));
app.use(express.urlencoded({
  limit: '50mb',
  parameterLimit: 50000,
  extended: true
}));

// Improved database connection with retry
const connectToDatabase = async (retries = 5, interval = 5000) => {
  if (mongoose.connection.readyState === 1) {
    console.log('Using existing MongoDB connection');
    return true;
  }
  
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("Error: MONGO_URL environment variable is not set.");
    return false;
  }

  let currentRetry = 0;
  
  while (currentRetry < retries) {
    try {
      await mongoose.connect(mongoUrl, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
        socketTimeoutMS: 45000
      });
      console.log("Connected to MongoDB");
      return true;
    } catch (err) {
      currentRetry++;
      console.error(`MongoDB connection attempt ${currentRetry} failed:`, err.message);
      
      if (currentRetry >= retries) {
        console.error("All MongoDB connection attempts failed");
        return false;
      }
      
      console.log(`Retrying in ${interval / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  return false;
};

// Connect to MongoDB immediately
connectToDatabase();

// Debug endpoint to test CORS
app.get('/api/cors-test', (req, res) => {
  // Get allowedOrigins from cors.js middleware if available
  const allowedOrigins = res.locals.allowedOrigins || 
    ['See cors.js middleware for complete list of allowed origins'];
    
  res.status(200).json({
    success: true,
    message: 'CORS is configured correctly',
    origin: req.headers.origin || 'No origin header',
    allowedOrigins: allowedOrigins,
    corsHeaders: {
      'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials'),
      'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': res.getHeader('Access-Control-Allow-Headers')
    }
  });
});

// Static routes setup
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));
}

// API Routes - maintain original dual mount points for auth routes
// to preserve backwards compatibility
app.use("/auth", authRoutes);  // This allows direct /auth/check-account-status access
app.use("/api/auth", authRoutes);  // This allows /api/auth/check-account-status access

// Other API Routes
app.use('/api/users', userRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/upload', uploadRoutes);

// Health check endpoint with improved database status
app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      state: dbStates[mongoose.connection.readyState] || 'unknown',
      connected: mongoose.connection.readyState === 1,
      models: Object.keys(mongoose.models).length
    },
    memoryUsage: process.memoryUsage(),
    cors: {
      headers: res.getHeaders()
    }
  };
  
  res.status(200).json(health);
});

// Middleware to inject a new token into the response if available
app.use((req, res, next) => {
  const oldSend = res.send;
  res.send = function(data) {
    if (res.locals.newToken && res.get('Content-Type')?.includes('application/json')) {
      try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        parsedData.newToken = res.locals.newToken;
        data = JSON.stringify(parsedData);
      } catch (error) {
        console.error('Error adding token to response:', error);
      }
    }
    return oldSend.call(this, data);
  };
  next();
});

// Catch-all route for undefined API endpoints
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.originalUrl}`
  });
});

// Consolidated error handler
app.use((err, req, res, next) => {
  // Create a unified error log entry
  const errorDetails = {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  };
  
  console.error('Application error:', errorDetails);
  
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  
  // Log additional info in development
  if (process.env.NODE_ENV !== 'production') {
    const networkInterfaces = require('os').networkInterfaces();
    let localIp = 'unknown';
    
    Object.keys(networkInterfaces).forEach((interfaceName) => {
      networkInterfaces[interfaceName].forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
        }
      });
    });
    
    console.log(`Access from mobile devices at http://${localIp}:${PORT}`);
  }
});

// Centralized unhandled rejection handler
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
});

// Export the app for serverless deployment
module.exports = app;