const axios = require('axios');
const { API_CONFIG } = require('../config/config');
const { logError } = require('../utils/utils');

// Improved token management with expiration tracking
let zoomTokenData = {
  token: null,
  expiresAt: 0
};

// Improved token function with expiration checking
async function getZoomToken() {
  const now = Date.now();
  // Return cached token if still valid (with 5-minute buffer)
  if (zoomTokenData.token && zoomTokenData.expiresAt > now + 300000) {
    return zoomTokenData.token;
  }
  
  try {
    const response = await axios.post(API_CONFIG.ZOOM_TOKEN_URL, {}, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')
      }
    });
    
    zoomTokenData = {
      token: response.data.access_token,
      expiresAt: now + (response.data.expires_in * 1000)
    };
    
    console.log('Zoom chatbot token received, expires in', response.data.expires_in, 'seconds');
    return zoomTokenData.token;
  } catch (error) {
    logError('Error getting Zoom chatbot token:', error);
    return null;
  }
}

// Helper function to convert markdown links to Zoom format
function convertMarkdownLinksToZoomFormat(text) {
  // Convert markdown links [text](url) to Zoom format <url|text>
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  return text.replace(markdownLinkRegex, (match, linkText, url) => {
    return `<${url}|${linkText}>`;
  });
}

// Format content for Zoom according to their API requirements
function formatZoomContent(content) {
  console.log("Formatting content for Zoom:", JSON.stringify(content));
  
  // Base content structure that matches Zoom's expected format
  let formattedContent = {};
  
  if (typeof content === 'string') {
    // Simple text message
    const zoomFormattedText = convertMarkdownLinksToZoomFormat(content);
    formattedContent = {
      "head": { "text": "GenZoom Bot" },
      "body": [
        {
          "type": "message",
          "is_markdown_support": true,
          "text": zoomFormattedText
        }
      ]
    };
  } else if (content.type === 'image') {
    // Image message
    formattedContent = {
      "head": { "text": "Generated Image" },
      "body": [
        {
          "type": "image",
          "image": {
            "url": content.image_url
          }
        }
      ]
    };
  } else if (content.head && content.body) {
    // Content already has head and body structure
    // Just ensure links are properly formatted in any text fields
    formattedContent = content;
    if (formattedContent.body && Array.isArray(formattedContent.body)) {
      formattedContent.body = formattedContent.body.map(item => {
        if (item.type === 'message' && item.text) {
          item.text = convertMarkdownLinksToZoomFormat(item.text);
          item.is_markdown_support = true;
        }
        return item;
      });
    }
  } else {
    // Default formatting if structure is unclear
    formattedContent = {
      "head": { "text": "GenZoom Bot" },
      "body": [
        {
          "type": "message",
          "is_markdown_support": true,
          "text": typeof content === 'object' ? JSON.stringify(content) : String(content)
        }
      ]
    };
  }
  
  console.log("Formatted content:", JSON.stringify(formattedContent));
  return formattedContent;
}

// Send message to Zoom chat.
async function sendZoomMessage(payload, content) {
  const accessToken = await getZoomToken();
  if (!accessToken) {
    console.error('Failed to retrieve Zoom access token. Cannot send message.');
    return;
  }
  
  // Format the content properly
  const formattedContent = formatZoomContent(content);
  
  const requestBody = {
    'robot_jid': process.env.ZOOM_BOT_JID,
    'to_jid': payload.toJid,
    'user_jid': payload.toJid,
    'account_id': payload.accountId,
    'content': formattedContent
  };
  
  try {
    console.log('Sending to Zoom:', JSON.stringify(requestBody, null, 2));
    const response = await axios.post(API_CONFIG.ZOOM_CHAT_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log('Successfully sent message to Zoom chat:', response.data);
  } catch (error) {
    logError('Error sending message to Zoom:', error);
    console.error('Request body:', JSON.stringify(requestBody, null, 2));
    
    // If there's an error with the image format, try sending a text message instead
    if (content.type === 'image') {
      console.log('Attempting to send error message instead of failed image');
      try {
        const errorMessage = formatZoomContent("I couldn't send the generated image due to a technical issue.");
        
        const errorRequestBody = {
          'robot_jid': process.env.ZOOM_BOT_JID,
          'to_jid': payload.toJid,
          'user_jid': payload.toJid,
          'account_id': payload.accountId,
          'content': errorMessage
        };
        
        await axios.post(API_CONFIG.ZOOM_CHAT_URL, errorRequestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        });
      } catch (fallbackError) {
        console.error('Even the fallback message failed:', fallbackError);
      }
    }
  }
}

// New function moved from responseHandlers.js to handle hybrid responses (search + image)
async function sendHybridZoomResponse(payload, exaResponse, imageUrl, enhancedContext) {
  await sendZoomMessage(payload, {
    'head': {
      'text': 'GenZoom Bot'
    },
    'body': [
      {
        'type': 'message',
        'is_markdown_support': true,
        'text': exaResponse
      },
      {
        'type': 'attachments',
        'resource_url': imageUrl,
        'img_url': imageUrl,
        'information': {
          'title': { 'text': 'AI-Generated Visualization' },
          'description': { 'text': `Based on: "${enhancedContext}"` }
        }
      }
    ]
  });
}

// New function moved from responseHandlers.js to handle text-only responses
async function sendTextZoomResponse(payload, text, title = 'Information') {
  await sendZoomMessage(payload, {
    'head': { 'text': title },
    'body': [{ 'type': 'message', 'text': text }]
  });
}

// New function moved from responseHandlers.js to handle image-only responses
async function sendImageZoomResponse(payload, imageUrl, promptText) {
  await sendZoomMessage(payload, {
    'head': {
      'text': 'GenZoom Bot'
    },
    'body': [
      {
        'type': 'attachments',
        'resource_url': imageUrl,
        'img_url': imageUrl,
        'information': {
          'title': { 'text': 'AI-Generated Image' },
          'description': { 'text': `Prompt: "${promptText}"` }
        }
      }
    ]
  });
}

module.exports = {
  getZoomToken,
  sendZoomMessage,
  sendHybridZoomResponse,
  sendTextZoomResponse,
  sendImageZoomResponse
}; 