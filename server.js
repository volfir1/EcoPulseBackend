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
const axios = require('axios'); // Add axios for proxying requests

// Create Express app
const app = express();

// Enable compression
app.use(compression());

// Improved CORS configuration for credentials support
app.use(cors({
  origin: function(origin, callback) {
    console.log("Request origin:", origin);

    // Allow localhost and undefined origin (for non-browser requests)
    if (!origin || origin.match(/http:\/\/localhost:\d+/)) {
      return callback(null, true);
    }
    
    // Allow any eco-pulse-final Vercel deployments
    if (origin.match(/https:\/\/eco-pulse-final[^.]*\.vercel\.app/)) {
      console.log("✅ Allowed Vercel deployment:", origin);
      return callback(null, true);
    }
    
    // Allow Railway backend
    if (origin.includes('ecopulsebackend-production.up.railway.app')) {
      return callback(null, true);
    }
    
    // Check against explicit allowed origins from env variable
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : [];
      
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Block everything else in production
    if (process.env.NODE_ENV === 'production') {
      console.log("🚨 Blocked origin:", origin);
      return callback(new Error('Not allowed by CORS'));
    }
    
    // Allow all origins in development
    return callback(null, true);
  },
  credentials: true
}));

// Ensure credentials header is always set
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Handle preflight requests explicitly 
app.options('*', cors());

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
      "https://eco-pulse-final-n3ablmy8k-eco-pulse.vercel.app",
      "https://eco-pulse-final-htgtozi7q-eco-pulse.vercel.app"
    ]
  });
});

// API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use('/api/users', userRoutes);
app.use('/api/ticket', ticketRoutes);
app.use('/api/upload', uploadRoutes);

// ==== ENERGY PREDICTION ENDPOINTS ====
// Handle all energy prediction routes
app.get('/api/predictions/:energyType', async (req, res) => {
  try {
    const { energyType } = req.params;
    const { start_year, end_year } = req.query;
    
    console.log(`Handling prediction request for ${energyType} energy (${start_year}-${end_year})`);
    
    // Generate mock prediction data
    const predictions = generatePredictions(energyType, start_year, end_year);
    
    res.json({ 
      success: true, 
      predictions 
    });
    
  } catch (error) {
    console.error('Error handling prediction request:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error retrieving prediction data',
      error: error.message
    });
  }
});

// ==== SOLAR RECOMMENDATIONS ENDPOINT ====
app.get('/api/solar_recommendations', async (req, res) => {
  try {
    const { year, budget } = req.query;
    console.log(`Handling solar recommendations request for year: ${year}, budget: ${budget}`);
    
    // Generate mock recommendations
    const recommendations = generateSolarRecommendations(year, budget);
    
    res.json({
      success: true,
      recommendations
    });
    
  } catch (error) {
    console.error('Error handling solar recommendations request:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error retrieving solar recommendations',
      error: error.message
    });
  }
});

// ==== PEER TO PEER ENERGY MARKET ENDPOINT ====
app.get('/api/peertopeer', async (req, res) => {
  try {
    const { year } = req.query;
    console.log(`Handling peer-to-peer energy market request for year: ${year}`);
    
    // Generate mock peer-to-peer market data
    const marketData = generatePeertoPeerMarketData(year);
    
    res.json({
      success: true,
      data: marketData
    });
    
  } catch (error) {
    console.error('Error handling peer-to-peer request:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error retrieving peer-to-peer market data',
      error: error.message
    });
  }
});

// ==== MANIFEST.JSON ENDPOINT ====
// Serve the manifest.json file for PWA support
app.get('/manifest.json', (req, res) => {
  res.json({
    "name": "EcoPulse",
    "short_name": "EcoPulse",
    "description": "Renewable energy prediction and analytics platform",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#16A34A",
    "icons": [
      {
        "src": "/icons/icon-192x192.png",
        "sizes": "192x192",
        "type": "image/png"
      },
      {
        "src": "/icons/icon-512x512.png",
        "sizes": "512x512",
        "type": "image/png"
      }
    ]
  });
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

// ==== MOCK DATA GENERATOR FUNCTIONS ====

// Generate mock predictions
function generatePredictions(energyType, startYear, endYear) {
  const predictions = [];
  startYear = parseInt(startYear) || 2025;
  endYear = parseInt(endYear) || 2030;
  
  for (let year = startYear; year <= endYear; year++) {
    // Base values and factors for different energy types
    let baseValue, growthRate;
    
    switch(energyType) {
      case 'solar':
        baseValue = 85 + (year % 10) * 8;
        growthRate = 1.2;
        break;
      case 'wind':
        baseValue = 92 + (year % 10) * 7;
        growthRate = 1.1;
        break;
      case 'hydro':
        baseValue = 78 + (year % 10) * 5;
        growthRate = 0.95;
        break;
      case 'biomass':
        baseValue = 65 + (year % 10) * 6;
        growthRate = 0.85;
        break;
      case 'geothermal':
        baseValue = 72 + (year % 10) * 7;
        growthRate = 1.05;
        break;
      default:
        baseValue = 80 + (year % 10) * 7;
        growthRate = 1.0;
    }
    
    // Add some random variation
    const randomOffset = Math.sin(year * 0.5) * 15;
    
    // Calculate growth trend
    const growthTrend = (year - startYear) * 2.5;
    
    // Calculate final value
    const value = (baseValue + randomOffset + growthTrend) * growthRate;
    
    predictions.push({
      Year: year,
      'Predicted Production': parseFloat(value.toFixed(2))
    });
  }
  
  return predictions;
}

// Generate mock solar recommendations
function generateSolarRecommendations(year, budget) {
  year = parseInt(year) || 2025;
  budget = parseInt(budget) || 50000;
  
  // Baseline efficiency improves with future years
  const efficiencyFactor = 1 + ((year - 2025) * 0.05);
  
  // Calculate system size based on budget
  const baseSystemSize = budget / 10000;
  const systemSize = Math.round(baseSystemSize * efficiencyFactor * 10) / 10;
  
  // Calculate production and financial metrics
  const annualProduction = Math.round(systemSize * 1400 * efficiencyFactor);
  const installationCost = budget;
  const annualSavings = Math.round(annualProduction * 0.15);
  const paybackPeriod = Math.round((installationCost / annualSavings) * 10) / 10;
  const roi = Math.round((annualSavings / installationCost) * 100 * 10) / 10;
  
  // Generate recommendations
  return {
    systemDetails: {
      year: year,
      budget: budget,
      systemSizeKW: systemSize,
      panelCount: Math.round(systemSize * 3),
      panelEfficiency: Math.round((15 + (year - 2025)) * efficiencyFactor * 10) / 10,
      inverterEfficiency: Math.min(98, Math.round((92 + (year - 2025)) * 10) / 10),
      systemType: budget > 30000 ? "Premium" : "Standard"
    },
    production: {
      annualProductionKWh: annualProduction,
      monthlyAverage: Math.round(annualProduction / 12),
      peakMonth: "June",
      peakProduction: Math.round(annualProduction / 12 * 1.5)
    },
    financial: {
      installationCost: installationCost,
      annualSavings: annualSavings,
      paybackPeriodYears: paybackPeriod,
      ROIPercentage: roi,
      lifetimeSavings: Math.round(annualSavings * 25)
    },
    environmentalImpact: {
      annualCO2Reduction: Math.round(annualProduction * 0.7),
      equivalentTrees: Math.round(annualProduction * 0.05),
      carbonFootprintReduction: Math.round(30 + Math.random() * 20) + "%"
    },
    recommendations: [
      "Install panels facing south for optimal production",
      "Consider adding battery storage for enhanced energy independence",
      `Schedule installation during ${year > 2025 ? "spring" : "fall"} for best pricing`,
      "Qualify for federal tax incentives by completing installation before year-end",
      `Upgrade to ${budget > 40000 ? "microinverters" : "power optimizers"} for shade mitigation`
    ]
  };
}

// Generate mock peer-to-peer energy market data
function generatePeertoPeerMarketData(year) {
  year = parseInt(year) || 2025;
  
  // Generate mock participants
  const participants = Math.round(100 + (year - 2025) * 50);
  const growthRate = Math.round((participants / 100) * 10) / 10;
  
  // Generate trading volume that increases with year
  const baseTrading = 1500 + (year - 2025) * 800;
  const tradingVolume = Math.round(baseTrading * (1 + Math.random() * 0.3));
  
  // Generate price data
  const avgSellingPrice = Math.round((12 + (year - 2025) * 0.5 + Math.random()) * 100) / 100;
  const avgBuyingPrice = Math.round((avgSellingPrice * 0.85) * 100) / 100;
  
  // Return mock market data
  return {
    marketOverview: {
      year: year,
      activeParticipants: participants,
      totalProducers: Math.round(participants * 0.4),
      totalConsumers: Math.round(participants * 0.6),
      marketGrowthRate: growthRate + "x",
      totalTradingVolumekWh: tradingVolume,
      averageTransactionSize: Math.round(tradingVolume / (participants * 5))
    },
    pricing: {
      averageSellingPricePerKWh: avgSellingPrice,
      averageBuyingPricePerKWh: avgBuyingPrice,
      peakPricingHours: "6PM - 9PM",
      lowestPricingHours: "10AM - 2PM",
      pricingVolatility: Math.round(10 - (year - 2025)) + "%"
    },
    topProducers: [
      { name: "SunValley Community", production: Math.round(tradingVolume * 0.08), reliability: "98%" },
      { name: "GreenLeaf Housing", production: Math.round(tradingVolume * 0.06), reliability: "97%" },
      { name: "EcoVillage Cooperative", production: Math.round(tradingVolume * 0.05), reliability: "99%" },
      { name: "Westside Solar Farm", production: Math.round(tradingVolume * 0.04), reliability: "96%" },
      { name: "Eastpoint Renewable", production: Math.round(tradingVolume * 0.03), reliability: "95%" }
    ],
    marketTrends: [
      "Increasing residential battery installations enabling more dynamic trading",
      "Growing preference for locally-produced renewable energy",
      "New participants joining at " + Math.round(5 + (year - 2025) * 2) + "% monthly rate",
      "Peak demand shifting to evening hours as EV adoption increases",
      "Smart contract automation reducing transaction overhead by " + Math.round(10 + (year - 2025) * 5) + "%"
    ],
    projections: {
      expectedGrowthNextYear: Math.round(20 + Math.random() * 10) + "%",
      priceTrend: "Gradually decreasing as supply increases",
      newParticipantsForecast: Math.round(participants * 0.3),
      technologyAdoption: year > 2026 ? "Advanced AI grid balancing" : "Basic automated trading"
    }
  };
}

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