const express = require("express");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/userRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const compression = require('compression');

// Create Express app
const app = express();

// Enable compression
app.use(compression());

// Single consolidated CORS configuration
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://eco-pulse-final.vercel.app', 
    'http://localhost:5173',
    'https://eco-pulse-final-git-main-eco-pulse.vercel.app',
    'https://hopeful-appreciation-production.up.railway.app',
    'https://ecopulsebackend-production.up.railway.app',
    'https://django-server-production-dac6.up.railway.app'
  ];
  
  const origin = req.headers.origin;
  console.log("Request origin:", origin);
  
  // Set CORS headers if origin is allowed
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    console.log("✅ Allowed origin:", origin);
  } else if (origin && origin.match(/http:\/\/localhost:\d+/)) {
    res.header('Access-Control-Allow-Origin', origin);
    console.log("✅ Allowed localhost:", origin);
  } else if (origin) {
    console.log("🚨 Blocked origin:", origin);
  }
  
  // Set other required CORS headers
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Parse cookies and JSON
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

// Serve static files only in development
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));
}

// MongoDB Connection - Optimized for serverless
const connectToDatabase = async () => {
  if (mongoose.connection.readyState) {
    console.log('Using existing MongoDB connection');
    return;
  }
  
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("Error: MONGO_URL environment variable is not set.");
    return;
  }

  try {
    await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      socketTimeoutMS: 45000
    });
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection failed:", err);
  }
};

// Connect to MongoDB immediately
connectToDatabase();

// Debug endpoint to test CORS
app.get('/api/cors-test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CORS is configured correctly',
    origin: req.headers.origin || 'No origin header',
    allowedOrigins: [
      "http://localhost:5173",
      "http://localhost:8000",
      "http://localhost:8080",
      "https://eco-pulse-final.vercel.app",
      "https://eco-pulse-final-git-main-eco-pulse.vercel.app",
      "https://hopeful-appreciation-production.up.railway.app",
      "https://ecopulsebackend-production.up.railway.app"
    ]
  });
});

// API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/users', userRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/upload', uploadRoutes);

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

// Health check endpoint for Vercel (used for monitoring)
app.get('/api/health', (req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState ? 'connected' : 'disconnected'
  };
  res.status(200).json(health);
});

// Catch-all route for undefined API endpoints
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.originalUrl}`
  });
});

// Start the server in both development and production
const PORT = process.env.PORT || 5173;
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

// Export the app for serverless deployment
module.exports = app;