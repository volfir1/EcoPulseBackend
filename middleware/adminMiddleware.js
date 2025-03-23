// middleware/adminMiddleware.js
const adminMiddleware = (req, res, next) => {
    console.log("=== ADMIN MIDDLEWARE STARTED ===");
    console.log("req.user available:", req.user ? "Yes" : "No");
    
    if (!req.user) {
      console.log("req.user is missing - authentication middleware didn't set it");
      console.log("=== ADMIN MIDDLEWARE FAILED ===");
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized. Authentication required" 
      });
    }
  
    console.log("req.user content:", req.user);
    
    // Check both possible locations of the role property
    const userRole = req.user.role || (req.user.userId && req.user.role);
    console.log("Detected user role:", userRole);
    
    if (userRole !== "admin") {
      console.log("User role is not admin");
      console.log("=== ADMIN MIDDLEWARE FAILED (NOT ADMIN) ===");
      return res.status(403).json({ 
        success: false, 
        message: "Unauthorized. Admin access required" 
      });
    }
  
    console.log("Admin role verified");
    console.log("=== ADMIN MIDDLEWARE COMPLETED SUCCESSFULLY ===");
    next();
  };
  
  module.exports = adminMiddleware;