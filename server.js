const express = require("express");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const userRoutes = require("./routes/userRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const compression = require('compression');

// Create Express app
const app = express();

// Enable compression
app.use(compression());

// Enhanced CORS configuration for Vercel deployment
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = process.env.ALLOWED_ORIGINS 
        ? process.env.ALLOWED_ORIGINS.split(',') 
        : [
            "http://localhost:5173",
            "http://192.168.1.2:8080",
            "http://192.168.1.2:8081", // Added 8081 port
            "http://10.0.2.2:8000",
            "http://10.0.2.2:8080",    // Added Android emulator with 8080
            "http://localhost:8000",
            "http://localhost:8080"     // Added localhost with 8080
          ];
      
      // Allow requests with no origin (like mobile apps)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        console.warn(`Origin ${origin} not allowed by CORS: ${origin}`);
        callback(new Error('CORS not allowed for this origin'));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true
  })
);

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

// Handle preflight requests explicitly for Vercel
app.options('*', cors());

// Serve static files only in development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000; // Changed to 8080 for consistency
  
  // Start the server only if not in production
  app.listen(PORT, '0.0.0.0', () => {
    const networkInterfaces = require('os').networkInterfaces();
    let localIp = 'unknown';
    
    Object.keys(networkInterfaces).forEach((interfaceName) => {
      networkInterfaces[interfaceName].forEach((iface) => {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
        }
      });
    });
    
    console.log(`Server running in development mode on port ${PORT}`);
    console.log(`Access from mobile devices at http://${localIp}:${PORT}`);
  });
  
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));
}

// MongoDB Connection - Optimized for serverless
const connectToDatabase = async () => {
  if (mongoose.connection.readyState) {
    console.log('Using existing MongoDB connection');
    return;
  }
  
  const mongoUrl = process.env.MONGO_URI;
  if (!mongoUrl) {
    console.error("Error: MONGO_URI environment variable is not set.");
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

// Export the app for serverless deployment (Vercel will handle the server start)
module.exports = app;