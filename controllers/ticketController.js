// controllers/ticketController.js
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const sendEmail = require('../sendgrid/emailService'); // You'll need to implement this

// Create a new ticket
exports.createTicket = async (req, res) => {
  try {
    const { subject, category, priority, description } = req.body;
    
    // Access the authenticated user from req.user
    const ticket = new Ticket({
      subject,
      user: req.user.userId,
      category,
      priority,
      messages: [{
        sender: req.user.userId,
        isAdmin: false,
        content: description
      }]
    });
    
    await ticket.save();
    
    // Notify admins about new ticket
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      sendEmail(
        admin.email,
        'New Support Ticket',
        `A new support ticket #${ticket.ticketNumber} has been created: ${subject}`
      );
    }
    
    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get user tickets
exports.getUserTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ user: req.user.userId })
      .sort({ updatedAt: -1 });
      
    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get all tickets (admin only)
exports.getAllTickets = async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access all tickets'
      });
    }
    
    let query = {};
    
    // Filter by assigned to current admin or unassigned
    if (req.query.assigned === 'me') {
      query.assignedTo = req.user.userId;
    } else if (req.query.assigned === 'unassigned') {
      query.assignedTo = null;
    }
    
    // Filter by category if specified
    if (req.query.category) {
      query.category = req.query.category;
    }
    
    // Filter by status if specified
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    const tickets = await Ticket.find(query)
      .populate('user', 'firstName lastName email profilePicture')
      .populate('assignedTo', 'firstName lastName email profilePicture')
      .sort({ priority: 1, updatedAt: -1 });
      
    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Get single ticket
exports.getTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('user', 'firstName lastName email profilePicture')
      .populate('assignedTo', 'firstName lastName email profilePicture');
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }
    
    // Check if user is authorized
    if (req.user.role !== 'admin' && 
        ticket.user._id.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this ticket'
      });
    }
    
    // Mark as read for the appropriate user type
    if (req.user.role === 'admin') {
      ticket.isRead.byAdmin = true;
    } else {
      ticket.isRead.byUser = true;
    }
    await ticket.save();
    
    res.status(200).json({
      success: true,
      data: ticket
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Reply to a ticket
exports.replyToTicket = async (req, res) => {
  try {
    const { content } = req.body;
    const { id } = req.params;
    
    const ticket = await Ticket.findById(id);
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }
    
    // Check if user is authorized
    const isAdmin = req.user.role === 'admin';
    const isTicketOwner = ticket.user.toString() === req.user.userId.toString();
    
    if (!isAdmin && !isTicketOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to reply to this ticket'
      });
    }
    
    // Add the message
    ticket.messages.push({
      sender: req.user.userId,
      isAdmin,
      content
    });
    
    // Update read status
    if (isAdmin) {
      ticket.isRead.byUser = false;
      ticket.isRead.byAdmin = true;
      
      // If ticket is open and admin replies, move to in-progress
      if (ticket.status === 'open') {
        ticket.status = 'in-progress';
      }
      
      // Assign ticket to this admin if not already assigned
      if (!ticket.assignedTo) {
        ticket.assignedTo = req.user.userId;
      }
    } else {
      ticket.isRead.byUser = true;
      ticket.isRead.byAdmin = false;
    }
    
    await ticket.save();
    
    // Send email notification
    if (isAdmin) {
      const user = await User.findById(ticket.user);
      sendEmail(
        user.email,
        `Update on your ticket #${ticket.ticketNumber}: ${ticket.subject}`,
        `You have received a reply to your support ticket.`
      );
    } else {
      if (ticket.assignedTo) {
        const admin = await User.findById(ticket.assignedTo);
        sendEmail(
          admin.email,
          `Customer replied: Ticket #${ticket.ticketNumber}`,
          `A customer has replied to ticket #${ticket.ticketNumber}`
        );
      } else {
        // Notify all admins if no specific admin is assigned
        const admins = await User.find({ role: 'admin' });
        for (const admin of admins) {
          sendEmail(
            admin.email,
            `Customer replied: Ticket #${ticket.ticketNumber}`,
            `A customer has replied to an unassigned ticket #${ticket.ticketNumber}`
          );
        }
      }
    }
    
    res.status(200).json({
      success: true,
      data: ticket
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Update ticket status (admin only)
exports.updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;
    
    // Only admins can change status
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to change ticket status'
      });
    }
    
    const ticket = await Ticket.findById(id);
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }
    
    ticket.status = status;
    await ticket.save();
    
    // Notify user about status change
    const user = await User.findById(ticket.user);
    sendEmail(
      user.email,
      `Ticket Status Updated: #${ticket.ticketNumber}`,
      `Your ticket status has been updated to: ${status}`
    );
    
    res.status(200).json({
      success: true,
      data: ticket
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Assign ticket (admin only)
exports.assignTicket = async (req, res) => {
  try {
    const { adminId } = req.body;
    const { id } = req.params;
    
    // Only admins can assign tickets
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to assign tickets'
      });
    }
    
    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }
    
    // Verify admin exists
    const admin = await User.findOne({ _id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }
    
    ticket.assignedTo = adminId;
    await ticket.save();
    
    // Notify assigned admin
    sendEmail(
      admin.email,
      `Ticket Assigned: #${ticket.ticketNumber}`,
      `You have been assigned to ticket #${ticket.ticketNumber}: ${ticket.subject}`
    );
    
    res.status(200).json({
      success: true,
      data: ticket
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Soft delete a ticket
exports.deleteTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }
    
    // Only ticket owner or admin can delete
    if (req.user.role !== 'admin' && 
        ticket.user.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this ticket'
      });
    }
    
    ticket.isDeleted = true;
    await ticket.save();
    
    res.status(200).json({
      success: true,
      message: 'Ticket deleted successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


exports.getTicketStats = async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access ticket statistics'
      });
    }
    
    // Get counts for different statuses
    const total = await Ticket.countDocuments();
    const open = await Ticket.countDocuments({ status: 'open' });
    const inProgress = await Ticket.countDocuments({ status: 'in-progress' });
    const resolved = await Ticket.countDocuments({ status: 'resolved' });
    const closed = await Ticket.countDocuments({ status: 'closed' });
    const unassigned = await Ticket.countDocuments({ assignedTo: null, status: { $ne: 'closed' } });
    
    res.status(200).json({
      success: true,
      data: {
        total,
        open,
        inProgress,
        resolved,
        closed,
        unassigned
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getAdmins = async (req, res) => {
  try {
    // Verify user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access admin list'
      });
    }
    
    const admins = await User.find({ role: 'admin' })
      .select('_id firstName lastName email profilePicture')
      .sort({ firstName: 1, lastName: 1 });
    
    res.status(200).json({
      success: true,
      data: admins
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users',
      error: error.message
    });
  }
};