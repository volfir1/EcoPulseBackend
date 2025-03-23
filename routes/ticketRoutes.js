const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const {
  createTicket,
  getUserTickets,
  getAllTickets,
  getTicket,
  replyToTicket,
  updateTicketStatus,
  assignTicket,
  deleteTicket,
  getTicketStats,
  getAdmins
} = require('../controllers/ticketController');

// All routes require authentication
router.use(auth);

// Place specific routes BEFORE parameter routes
router.post('/', createTicket);
router.get('/user', getUserTickets);
router.get('/all', getAllTickets);
router.get('/stats', getTicketStats);
router.get('/admins', getAdmins); // Moved this before /:id routes

// Parameter routes come last
router.get('/:id', getTicket);
router.post('/:id/reply', replyToTicket);
router.put('/:id/status', updateTicketStatus);
router.put('/:id/assign', assignTicket);
router.delete('/:id', deleteTicket);

module.exports = router;