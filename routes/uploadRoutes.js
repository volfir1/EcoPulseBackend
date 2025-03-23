// Check your uploadRoutes.js file. It should look something like this:
const express = require('express');
const router = express.Router();
const { uploadAvatar, uploadBase64Avatar, uploadDefaultAvatar, base64AvatarLimiter} = require('../controllers/uploadController');
const authMiddleware = require('../middleware/authMiddleware');
const { upload } = require('../utils/cloudinary');

// All upload routes require authentication
router.use(authMiddleware);

// Route for handling multipart form uploads (regular file upload)
router.post('/avatar', upload.single('avatar'), uploadAvatar);

// Route for handling base64 encoded images (direct upload from web)
router.post('/avatar/base64',base64AvatarLimiter, uploadBase64Avatar);
router.post('/avatar',base64AvatarLimiter, uploadBase64Avatar);
// Route for default avatar uploads
router.post('/default-avatar', uploadDefaultAvatar);

module.exports = router;