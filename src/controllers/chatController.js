const userContextManager = require('../services/userContext');
const { sendZoomMessage } = require('../api/zoom');
const { dateUtils } = require('../utils/utils');
const { callExaAPI } = require('../api/exa');
const { 
  generateTextResponse, 
  generateImageResponse, 
  callExaAPIWithVerification, 
  analyzeQueryAndDecideResponse, 
  generateHybridResponse 
} = require('../services/responseHandlers');

// Main handler for chat requests
async function handleChatRequest(req, res) {
  try {
    console.log('Incoming Zoom chat request:', JSON.stringify(req.body, null, 2));
    console.log(`Received Zoom event: ${req.body.event}`);
    
    // Immediately send a 200 response to acknowledge receipt
    res.status(200).json({ message: 'Event received. Processing...', status: 200 });
    
    console.log('Zoom Team Chat message received.');
    const userId = req.body.payload.userId;
    let userMessage = req.body.payload.cmd;

    // Check for name registration
    if (userMessage.toLowerCase().startsWith("my name is ")) {
      const name = userMessage.substring(11).trim();
      userContextManager.setName(userId, name);
      console.log(`User ${userId} set their name as: ${name}`);
      await sendZoomMessage(req.body.payload, {
        'type': 'message',
        'text': `Thanks, I'll remember your name as ${name}.`
      });
      return;
    }

    // Add user message to history with a prefix to distinguish it
    userContextManager.addMessage(userId, `User: ${userMessage}`);
    
    // Process query with date substitutions
    const processedQuery = dateUtils.processQuery(userMessage);
    
    // Combined analysis
    const { extractedContext, responseType } = await analyzeQueryAndDecideResponse(processedQuery, userId);
    
    console.log(`Analysis results - Context: "${extractedContext}", Response Type: ${responseType}`);
    
    let botResponse = "";
    
    if (responseType === "text_response") {
      botResponse = await generateTextResponse(userMessage, userId);
      await sendZoomMessage(req.body.payload, botResponse);
    } else if (responseType === "image_request") {
      const success = await generateImageResponse(userMessage, extractedContext, req.body.payload);
      botResponse = success 
        ? `[Generated image based on: "${extractedContext}"]`
        : "I'm sorry, but I couldn't generate an image at this time.";
      
      if (!success) {
        await sendZoomMessage(req.body.payload, botResponse);
      }
    } else if (responseType === "exa_response") {
      // Use the verified Exa API call instead of direct call
      botResponse = await callExaAPIWithVerification(processedQuery);
      if (!botResponse) {
        console.log("No verified response from Exa, falling back to regular Exa call");
        botResponse = await callExaAPI(processedQuery);
        if (!botResponse) {
          botResponse = "I'm sorry, but I couldn't retrieve current information at this time.";
        }
      }
      
      await sendZoomMessage(req.body.payload, botResponse);
    } else if (responseType === "hybrid_response") {
      // Handle the hybrid response type
      botResponse = await generateHybridResponse(processedQuery, extractedContext, req.body.payload);
    } else {
      botResponse = "I'm sorry, but I couldn't determine the correct response type.";
      await sendZoomMessage(req.body.payload, botResponse);
    }
    
    // Add bot response to history with a prefix
    userContextManager.addMessage(userId, `Bot: ${botResponse}`);
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Response already sent, so we just log the error
  }
}

module.exports = {
  handleChatRequest
}; 