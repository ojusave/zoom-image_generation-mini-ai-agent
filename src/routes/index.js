const express = require('express');
const chatController = require('../controllers/chatController');

const router = express.Router();

// Main /chat endpoint to handle all Zoom chat interactions
router.post('/chat', chatController.handleChatRequest);

module.exports = router; 