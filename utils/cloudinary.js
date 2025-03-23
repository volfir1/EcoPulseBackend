const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'ecopulse_avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'svg'],
    transformation: [
      { width: 500, height: 500, crop: 'limit' },
      { fetch_format: 'auto', quality: 'auto' }
    ]
  }
});

// Create the multer upload middleware
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB
  }
});

// Export both cloudinary instance and multer middleware
module.exports = {
  cloudinary,
  upload
};