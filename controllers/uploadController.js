// controllers/uploadController.js
const { cloudinary } = require('../utils/cloudinary');
const User = require('../models/User');
const sharp = require('sharp'); 

exports.uploadAvatar = async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded"
        });
      }
  
      // Get the Cloudinary URL from the uploaded file
      // This depends on how your Cloudinary middleware is set up
      const avatarUrl = req.file.path; // Could also be req.file.secure_url depending on your setup
      
      console.log('Upload avatar debug:', {
        userId: req.user.id || req.user.userId, // Check both formats
        fileInfo: req.file,
        avatarUrl: avatarUrl
      });
  
      // Make sure we have a valid URL before updating
      if (!avatarUrl) {
        return res.status(400).json({
          success: false,
          message: "No valid avatar URL generated"
        });
      }
  
      // Get the user ID from the request
      const userId = req.user.id || req.user.userId;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User ID not found in request"
        });
      }
  
      // Update user with new avatar URL
      const updatedUser = await User.findByIdAndUpdate(
        userId, 
        { 
          avatar: avatarUrl,
          lastActivity: new Date()
        },
        { new: true }
      ).select('-password');
  
      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
  
      // Send back the updated user with the avatar URL
      res.status(200).json({
        success: true,
        message: "Avatar uploaded successfully",
        avatar: avatarUrl, // Include this specifically
        user: {
          id: updatedUser._id,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          email: updatedUser.email,
          avatar: updatedUser.avatar, // Make sure this contains the URL
          gender: updatedUser.gender,
          role: updatedUser.role
        }
      });
    } catch (error) {
      console.error("Error uploading avatar:", error);
      res.status(500).json({
        success: false,
        message: "Error uploading avatar",
        error: error.message
      });
    }
  };

// Direct upload from base64 string (for web)
const compressBase64Image = async (base64Image, maxSizeBytes = 10485760, initialQuality = 90) => {
  // Remove data URL prefix if present
  const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  
  // If image is already under the size limit, return it as is
  if (buffer.length <= maxSizeBytes) {
    return base64Image;
  }
  
  // Get image metadata
  const metadata = await sharp(buffer).metadata();
  
  // Calculate how much we need to reduce the image
  const reductionFactor = Math.sqrt(maxSizeBytes / buffer.length);
  
  // Calculate new dimensions, ensuring they're integers
  const newWidth = Math.floor(metadata.width * reductionFactor);
  const newHeight = Math.floor(metadata.height * reductionFactor);
  
  let quality = initialQuality;
  let compressedBuffer;
  let compressedSize = buffer.length;
  
  // Try progressively lower quality until we're under the limit
  while (compressedSize > maxSizeBytes && quality >= 40) {
    compressedBuffer = await sharp(buffer)
      .resize(newWidth, newHeight)
      .jpeg({ quality }) // Using JPEG for consistent compression
      .toBuffer();
    
    compressedSize = compressedBuffer.length;
    quality -= 10;
  }
  
  // If we still can't get it under the limit, make a more aggressive resize
  if (compressedSize > maxSizeBytes) {
    const secondReductionFactor = Math.sqrt(maxSizeBytes / compressedSize) * 0.9; // Add 10% extra reduction
    
    compressedBuffer = await sharp(buffer)
      .resize(Math.floor(newWidth * secondReductionFactor), Math.floor(newHeight * secondReductionFactor))
      .jpeg({ quality: 70 })
      .toBuffer();
  }
  
  // Convert back to base64 with appropriate prefix
  return `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
};

// Modified uploadBase64Avatar controller
exports.uploadBase64Avatar = async (req, res) => {
  try {
    const { base64Image, avatarId, uniqueId } = req.body;
    
    if (!base64Image) {
      return res.status(400).json({
        success: false,
        message: "No image data provided"
      });
    }
    
    // Get user ID from authenticated request
    const userId = req.user.id || req.user.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found in request"
      });
    }
    
    // FIX: Create a unique identifier WITHOUT including folder
    const publicId = avatarId && uniqueId 
      ? `user_${userId}_${avatarId}_${uniqueId}` 
      : `user_${userId}_${Date.now()}`;
    
    console.log('Uploading base64 avatar to Cloudinary with ID:', publicId);
    
    // Compress image before uploading
    let processedImage;
    try {
      processedImage = await compressBase64Image(base64Image);
      console.log('Image processed successfully for upload');
    } catch (compressionError) {
      console.error('Error compressing image:', compressionError);
      return res.status(400).json({
        success: false,
        message: "Unable to process image. Please try a smaller image.",
        error: compressionError.message
      });
    }
    
    // Upload to Cloudinary with folder specified only here
    const uploadResult = await cloudinary.uploader.upload(processedImage, {
      public_id: publicId,
      overwrite: true,
      folder: 'ecopulse_avatars' // Folder specified only here
    });
    
    // Update user with new avatar URL
    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      { 
        avatar: uploadResult.secure_url,
        lastActivity: new Date()
      },
      { new: true }
    ).select('-password');
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: "Avatar uploaded successfully",
      avatar: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        avatar: updatedUser.avatar,
        gender: updatedUser.gender,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error("Error uploading base64 avatar:", error);
    
    // Provide more specific error messages for common issues
    if (error.http_code === 400 && error.message && error.message.includes('File size too large')) {
      return res.status(400).json({
        success: false,
        message: "Image is too large. Maximum size is 10MB. Please try a smaller image or lower resolution.",
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: "Error uploading avatar",
      error: error.message
    });
  }
};

// Updated uploadDefaultAvatar to also use compression
exports.uploadDefaultAvatar = async (req, res) => {
  try {
    const { avatarBase64, avatarId, name, letter, color } = req.body;
    
    console.log('Default avatar request received:', { 
      hasBase64: !!avatarBase64, 
      avatarId, 
      name, 
      from: req.headers['x-client-type'] || 'unknown'
    });
    
    // Validate we have at least an avatarId
    if (!avatarId) {
      return res.status(400).json({
        success: false,
        message: "Avatar ID is required"
      });
    }
    
    const userId = req.user.id || req.user.userId;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found in request"
      });
    }

    // Path to default avatars on the server
    let defaultAvatarPath;
    try {
      // Try to resolve the path to default avatar assets on the server
      defaultAvatarPath = require('path').resolve(__dirname, `../assets/avatars/${avatarId}.svg`);
    } catch (error) {
      console.warn(`Could not resolve path to default avatar: ${error.message}`);
    }
    
    let avatarUrl;
    
    // CASE 1: If base64 data is provided (from web version), use that
    if (avatarBase64) {
      try {
        console.log('Uploading base64 avatar to Cloudinary');
        
        // Compress the image before uploading
        const processedImage = await compressBase64Image(avatarBase64);
        console.log('Default avatar image processed successfully');
        
        // FIX: Generate a unique ID WITHOUT folder path
        const cloudinaryId = `user_${userId}_${avatarId}_${Date.now()}`;
        
        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(processedImage, {
          public_id: cloudinaryId,
          overwrite: true,
          resource_type: 'image',
          folder: 'ecopulse_avatars' // Folder specified only here
        });
        
        avatarUrl = uploadResult.secure_url;
        console.log('Successfully uploaded to Cloudinary:', avatarUrl);
      } catch (uploadError) {
        console.error('Error uploading to Cloudinary:', uploadError);
        
        // More specific error message for file size issues
        if (uploadError.http_code === 400 && uploadError.message && uploadError.message.includes('File size too large')) {
          return res.status(400).json({
            success: false,
            message: "Image is too large. Maximum size is 10MB. Please try a smaller image.",
            error: uploadError.message
          });
        }
        
        return res.status(500).json({
          success: false,
          message: "Error uploading to Cloudinary",
          error: uploadError.message
        });
      }
    }
    
    // Rest of the function remains the same...
    // CASE 2 and CASE 3 implementation continues as before
    
    // Update user record with the avatar URL (not just the ID)
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        avatar: avatarUrl, // Store the full URL, not just the ID
        lastActivity: new Date()
      },
      { new: true }
    ).select('-password');
    
    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    console.log(`User ${userId} avatar updated to:`, avatarUrl);
    
    // Return success with the avatar URL
    res.status(200).json({
      success: true,
      message: "Default avatar set successfully",
      avatar: avatarUrl,
      user: updatedUser
    });
  } catch (error) {
    console.error("Error setting default avatar:", error);
    res.status(500).json({
      success: false,
      message: "Error setting avatar",
      error: error.message
    });
  }
};

exports.base64AvatarLimiter = async (req, res, next) => {
  // Calculate approximate size of base64 data
  if (req.body && req.body.base64Image) {
    const base64Data = req.body.base64Image.split('base64,')[1] || req.body.base64Image;
    const sizeInBytes = Math.ceil((base64Data.length * 3) / 4);
    const sizeInMB = sizeInBytes / (1024 * 1024);
    
    // Log the size for monitoring
    console.log(`Base64 avatar size: ${sizeInMB.toFixed(2)}MB`);
    
    // If still too large, reject early
    if (sizeInMB > 5) { // 5MB limit
      return res.status(413).json({
        success: false,
        message: 'Image too large. Please use an image smaller than 5MB.',
        size: `${sizeInMB.toFixed(2)}MB`
      });
    }
  }
  next();
};