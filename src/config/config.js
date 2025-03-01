require('dotenv').config();

const API_CONFIG = {
  ANTHROPIC_URL: 'https://api.anthropic.com/v1/messages',
  FLUX_URL: 'https://api.us1.bfl.ai/v1/flux-pro-1.1',
  ZOOM_TOKEN_URL: 'https://zoom.us/oauth/token?grant_type=client_credentials',
  ZOOM_CHAT_URL: 'https://api.zoom.us/v2/im/chat/messages',
};

module.exports = { API_CONFIG }; 