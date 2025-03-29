// routes/adminRoutes.js
const express = require("express");
const router = express.Router();

const accountController = require("../controllers/accountController");

const authMiddleware = require("../middleware/auth").authenticateJWT;
const adminMiddleware = require("../middleware/auth").isAdmin;

// Apply auth and admin middleware to all routes
router.use(authMiddleware, adminMiddleware);

// User management routes from accountController
router.post('/users/deactivate', accountController.adminDeactivateUser);

module.exports = router;