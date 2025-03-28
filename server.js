const express = require("express");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/userRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const compression = require('compression');
const authRoutes = require("./routes/authRoutes");

// Create Express app
const app = express();

// Enable compression
app.use(compression());

// Parse and sanitize ALLOWED_ORIGINS environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [
      'https://eco-pulse-final.vercel.app', 
      'http://localhost:5173',
      'https://eco-pulse-final-git-main-eco-pulse.vercel.app',
      'https://hopeful-appreciation-production.up.railway.app',
      'https://ecopulsebackend-production.up.railway.app',
      'https://django-server-production-dac6.up.railway.app'
    ];

// Enhanced CORS middleware with debug logging
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isPreflight = req.method === 'OPTIONS';

  // Log request details
  console.log(`\n=== Incoming ${req.method} request ===`);
  console.log('Origin:', origin || 'No origin header');
  console.log('Path:', req.path);
  console.log('Allowed Origins:', allowedOrigins);

  // Handle preflight requests
  if (isPreflight) {
    console.log('Processing preflight request');
    const allowedOrigin = allowedOrigins.find(o => o === origin);
    
    if (allowedOrigin || (origin && origin.match(/http:\/\/localhost:\d+/))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
      res.header('Access-Control-Allow-Credentials', 'true');
      console.log(`✅ Allowed preflight for origin: ${origin}`);
      return res.status(204).end();
    }
    
    console.log(`🚨 Blocked preflight for origin: ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // Handle regular requests
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    console.log(`✅ Allowed origin: ${origin}`);
  } else if (origin && origin.match(/http:\/\/localhost:\d+/)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    console.log(`✅ Allowed localhost: ${origin}`);
  } else if (origin) {
    console.log(`🚨 Blocked origin: ${origin}`);
  }

  next();
});

// Enhanced debug logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Cookies:', req.cookies);
  console.log('Headers:', req.headers);
  
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode}`);
  });
  
  next();
});

// Body parsing middleware
app.use(express.json({
  limit: '50mb',
  parameterLimit: 50000
}));
app.use(express.urlencoded({
  limit: '50mb',
  parameterLimit: 50000,
  extended: true
}));

// Cookie parser
app.use(cookieParser());

// Static files (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));
}

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      socketTimeoutMS: 45000
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

connectDB();

// Routes
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/upload', uploadRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    uptime: process.uptime(),
    dbState: mongoose.STATES[mongoose.connection.readyState]
  });
});

// Token injection middleware
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(body) {
    if (res.locals.newToken) {
      try {
        const jsonBody = JSON.parse(body);
        jsonBody.newToken = res.locals.newToken;
        body = JSON.stringify(jsonBody);
      } catch (e) {
        console.error('Error adding token to response:', e);
      }
    }
    originalSend.call(this, body);
  };
  next();
});

// Error handling
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error: ${err.message}`);
  res.status(err.statusCode || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Server error'
  });
});

// Start server
const PORT = process.env.PORT || 5173;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;