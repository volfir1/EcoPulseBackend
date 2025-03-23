// models/User.js
const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { 
    type: String, 
    required: function() {
      // Password is required unless the user is using OAuth
      return !this.googleId;
    }
  },
  googleId: { type: String, unique: true, sparse: true },
  
  // Gender field with inclusive options
  gender: {
    type: String,
    enum: ["male", "female", "non-binary", "transgender", "other", "prefer-not-to-say"],
    default: "prefer-not-to-say"
  },
  
  // Avatar selection instead of profile picture upload
  avatar: {
    type: String,
    default: "default-avatar" // Default avatar identifier
  },
  
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user"
  },
  resetPasswordShortCode: {
    type: String,
    default: null
  },
  lastLogin: { type: Date, default: null },
  lastActivity: { type: Date, default: Date.now },
  isDeactivated: { type: Boolean, default: false },
  
  // Auto-deactivation tracking
  isAutoDeactivated: { type: Boolean, default: false },
  autoDeactivatedAt: { type: Date, default: null },
  
  // Fields for email verification
  isVerified: { type: Boolean, default: false },
  verificationCode: { type: String, trim: true },
  verificationCodeExpires: { type: Date },
  
  // Reset Password fields
  resetPasswordToken: { type: String, trim: true },
  resetPasswordExpires: { type: Date },
  
  // Account reactivation fields
  reactivationToken: { type: String, default: null, trim: true },
  reactivationTokenExpires: { type: Date, default: null },
  reactivationAttempts: { type: Number, default: 0 },
  lastReactivationAttempt: { type: Date, default: null },
  
  // Tracking original values for recovery
  originalEmail: { type: String, trim: true }
}, { timestamps: true });

// Virtual for full name
UserSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// toJSON transformation to remove sensitive fields when serializing
UserSchema.set('toJSON', {
  transform: (doc, ret, options) => {
    delete ret.password;
    delete ret.verificationCode;
    delete ret.verificationCodeExpires;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;
    delete ret.reactivationToken;
    delete ret.reactivationTokenExpires;
    delete ret.reactivationAttempts;
    delete ret.lastReactivationAttempt;
    return ret;
  }
});

// Pre-hook to exclude deleted users unless explicitly queried for them
UserSchema.pre(['find', 'findOne', 'findById'], function(next) {
  if (this.getQuery() && Object.prototype.hasOwnProperty.call(this.getQuery(), 'isDeactivated')) {
    return next();
  }
  this.where({ isDeactivated: { $ne: true } });
  next();
});

// Method to check if the user account is inactive (no activity for over a month)
UserSchema.methods.isInactive = function() {
  if (!this.lastActivity) return false;
  
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  
  return this.lastActivity < oneMonthAgo;
};

// Method to update last activity timestamp
UserSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  return this.save();
};

module.exports = mongoose.model("User", UserSchema);
