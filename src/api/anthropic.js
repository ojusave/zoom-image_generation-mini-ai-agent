const axios = require('axios');
const { API_CONFIG } = require('../config/config');
const { logError } = require('../utils/utils');

// Unified Anthropic API call function
async function callAnthropicAPI(prompt, options = {}) {
  const {
    mode = "generic",
    maxTokens = 100,
    systemPrompt = "",
    model = "claude-3-7-sonnet-20250219"
  } = options;
  
  // Select appropriate system prompt based on mode
  let finalSystemPrompt = systemPrompt;
  if (!systemPrompt) {
    switch (mode) {
      case "extract_context":
        finalSystemPrompt = "Extract the most relevant subjects or details from the following conversation context and query. If the query refers to previous subjects (using terms like 'both', 'them', 'these', etc.), include ALL recently mentioned subjects. If multiple subjects are present, join them with ' and '. Return only the extracted details.";
        break;
      case "decide_response":
        finalSystemPrompt = "Analyze the query and context to determine the most appropriate response type.";
        break;
      case "text_response":
        finalSystemPrompt = "You are a chatbot that uses the conversation context to answer the following query in detail. If the query is about a specific event, provide the most accurate information available.";
        break;
      default:
        finalSystemPrompt = "You are a helpful AI assistant.";
    }
  }
  
  try {
    const payload = {
      model,
      system: finalSystemPrompt,
      messages: [{ "role": "user", "content": prompt }],
      max_tokens: mode === "text_response" ? Math.max(maxTokens, 200) : maxTokens
    };
    
    const response = await axios.post(API_CONFIG.ANTHROPIC_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      timeout: 15000 // Add a reasonable timeout
    });
    
    return response.data.content[0].text.trim();
  } catch (error) {
    logError('Error calling Anthropic API:', error);
    return mode === "text_response" ? "I'm sorry, but I couldn't generate a response at this time." : "text_response";
  }
}

// Improve prompts for different purposes
async function improvePrompt(originalPrompt, type = "image") {
  try {
    let systemPrompt;
    
    if (type === "image") {
      systemPrompt = "Enhance the given text into a highly detailed, vivid, and structured image generation prompt that emphasizes near-realism. Do not return any unrelated text.";
    } else if (type === "exa") {
      systemPrompt = "Rewrite the following search query so that it clearly asks for the most up-to-date and current information. Do not add any extra commentary; output only the refined query.";
    }
    
    return await callAnthropicAPI(`Improve this ${type} prompt: "${originalPrompt}"`, {
      systemPrompt,
      maxTokens: 100
    });
  } catch (error) {
    logError(`Error improving ${type} prompt:`, error);
    return originalPrompt;
  }
}

module.exports = {
  callAnthropicAPI,
  improvePrompt
}; 