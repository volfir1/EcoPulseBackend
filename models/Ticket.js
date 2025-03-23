// models/Ticket.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  isAdmin: { type: Boolean, default: false },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    unique: true
  },
  subject: { type: String, required: true },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  category: { type: String, required: true },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  messages: [messageSchema],
  status: { 
    type: String, 
    enum: ['open', 'in-progress', 'resolved', 'closed'],
    default: 'open' 
  },
  assignedTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    default: null
  },
  isRead: { 
    byUser: { type: Boolean, default: true },
    byAdmin: { type: Boolean, default: false }
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Generate ticket number before saving
ticketSchema.pre('save', async function(next) {
    if (!this.ticketNumber) {
      // Get current date as YYYYMMDD
      const date = new Date();
      const dateString = date.getFullYear().toString() +
        (date.getMonth() + 1).toString().padStart(2, '0') +
        date.getDate().toString().padStart(2, '0');
      
      // Find the latest ticket for today
      const latestTicket = await this.constructor.findOne({
        ticketNumber: { $regex: `^${dateString}` },
        isDeleted: { $ne: true }
      }).sort({ ticketNumber: -1 });
      
      // Generate new ticket number
      let number = 1;
      if (latestTicket && latestTicket.ticketNumber) {
        const latestNumber = parseInt(latestTicket.ticketNumber.substring(8));
        number = latestNumber + 1;
      }
      
      this.ticketNumber = `${dateString}${number.toString().padStart(3, '0')}`;
    }
    next();
  });

// Skip deleted tickets in queries (matching your User model pattern)
ticketSchema.pre(['find', 'findOne'], function(next) {
  this.where({ isDeleted: { $ne: true } });
  next();
});

module.exports = mongoose.model("Ticket", ticketSchema);