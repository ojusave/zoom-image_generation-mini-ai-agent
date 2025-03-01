// Optimized user context management with automatic cleanup
const userContextManager = {
  contexts: {},
  maxHistoryLength: 10,
  expirationMs: 24 * 60 * 60 * 1000, // 24 hours
  
  // Get or create user context
  getContext(userId) {
    if (!this.contexts[userId]) {
      this.contexts[userId] = {
        messages: [],
        lastActivity: Date.now(),
        name: null
      };
    } else {
      // Update last activity timestamp
      this.contexts[userId].lastActivity = Date.now();
    }
    return this.contexts[userId];
  },
  
  // Add message to user context
  addMessage(userId, message) {
    const context = this.getContext(userId);
    context.messages.push(message);
    if (context.messages.length > this.maxHistoryLength) {
      context.messages.shift();
    }
  },
  
  // Get conversation history as string
  getConversationString(userId) {
    const context = this.getContext(userId);
    return context.messages.join(" | ");
  },
  
  // Set user name
  setName(userId, name) {
    const context = this.getContext(userId);
    context.name = name;
  },
  
  // Clean up expired contexts - call this periodically
  cleanup() {
    const now = Date.now();
    const expiredIds = [];
    
    for (const [userId, context] of Object.entries(this.contexts)) {
      if (now - context.lastActivity > this.expirationMs) {
        expiredIds.push(userId);
      }
    }
    
    expiredIds.forEach(id => delete this.contexts[id]);
    if (expiredIds.length > 0) {
      console.log(`Cleaned up ${expiredIds.length} expired user contexts`);
    }
  },

  // Initialize periodic cleanup
  init() {
    // Set up periodic cleanup every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }
};

module.exports = userContextManager; 