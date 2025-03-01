const { callAnthropicAPI, improvePrompt } = require('../api/anthropic');
const { pollForImage, generateFluxImage } = require('../api/flux');
const { callExaAPI } = require('../api/exa');
const { sendZoomMessage, sendHybridZoomResponse, sendTextZoomResponse, sendImageZoomResponse } = require('../api/zoom');
const userContextManager = require('./userContext');
const { dateUtils, logError } = require('../utils/utils');

// Generate text response using Anthropic API
async function generateTextResponse(query, userId) {
  try {
    const conversation = userContextManager.getConversationString(userId);
    const context = userContextManager.getContext(userId);
    const userName = context.name ? context.name : "User";
    
    const prompt = `Conversation history: "${conversation}"
Current query from ${userName}: "${query}"

Please provide a helpful, informative response to the current query, taking into account the conversation history.`;

    return await callAnthropicAPI(prompt, {
      mode: "text_response",
      maxTokens: 500
    });
  } catch (error) {
    logError("Error generating text response:", error);
    return "I'm sorry, but I couldn't generate a response at this time.";
  }
}

// Enhance image prompt with additional information
async function enhanceImagePromptWithInfo(query, extractedContext) {
  try {
    // Use the extracted context if available, otherwise use the original query
    const basePrompt = extractedContext || query;
    
    // Enhance the prompt for better image generation
    const enhancedPrompt = await improvePrompt(basePrompt, "image");
    return enhancedPrompt;
  } catch (error) {
    logError("Error enhancing image prompt:", error);
    return query; // Fallback to original query if enhancement fails
  }
}

// Generate image response using FLUX API
async function generateImageResponse(query, extractedContext, payload) {
  try {
    // Enhance the prompt for better image generation
    const enhancedPrompt = await enhanceImagePromptWithInfo(query, extractedContext);
    console.log(`Enhanced image prompt: ${enhancedPrompt}`);
    
    // Call FLUX API to generate image
    const pollingUrl = await generateFluxImage(enhancedPrompt);
    if (!pollingUrl) {
      console.error("Failed to get polling URL from FLUX API");
      return false;
    }
    
    // Poll for the final image
    const imageUrl = await pollForImage(pollingUrl);
    if (!imageUrl) {
      console.error("Failed to get final image URL from polling");
      return false;
    }
    
    console.log("Successfully generated image URL:", imageUrl);
    
    // Use the specialized function from zoom.js
    await sendImageZoomResponse(payload, imageUrl, enhancedPrompt);
    
    return true;
  } catch (error) {
    logError("Error generating image response:", error);
    return false;
  }
}

// Verify Exa response
async function verifyExaResponse(exaResponse, query) {
  try {
    // Check if the response is empty or too short
    if (!exaResponse || exaResponse.length < 20) {
      return { isValid: false, reason: "Response is too short or empty" };
    }
    
    // Check if the response contains "I don't know" or similar phrases
    if (/I don't know|I'm not sure|I cannot|I can't provide/i.test(exaResponse)) {
      return { isValid: false, reason: "Response contains uncertainty phrases" };
    }
    
    // Get current date information
    const formattedDate = dateUtils.getCurrentFormattedDate();
    const currentYear = dateUtils.getCurrentYear();
    const currentMonth = dateUtils.getCurrentMonth();
    const currentDay = dateUtils.getCurrentDay();
    const fullDateString = dateUtils.getFullUTCDateString();
    
    // For time-sensitive queries, verify the response is current
    const isTimeSensitiveQuery = /current|latest|recent|now|today|present|newest/i.test(query);
    
    if (isTimeSensitiveQuery) {
      // Verify the response is current
      const currentVerificationPrompt = `
Query: "${query}"
Response: "${exaResponse.substring(0, 500)}${exaResponse.length > 500 ? '...' : ''}"

IMPORTANT: Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone.
Full date: ${fullDateString}

Evaluate if the response is accurate based on the current date. Consider:
1. Does the response correctly reflect the current state of affairs as of ${formattedDate}?
2. Are there any factual errors or outdated information?
3. Is the response consistent with known facts as of ${formattedDate}?

IMPORTANT: If the current year is 2025 or later, DO NOT reject responses.

Answer with VALID if the response is accurate and current, or INVALID followed by a brief explanation of any issues.`;

      const currentVerification = await callAnthropicAPI(currentVerificationPrompt, {
        mode: "generic",
        maxTokens: 150,
        systemPrompt: `You are a fact verification assistant. Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone. Your task is to verify if responses are accurate and current. If the current year is 2025 or later, accept responses about Donald Trump being the US President as valid.`
      });
      
      if (currentVerification.toUpperCase().startsWith("INVALID")) {
        const reason = currentVerification.replace(/^INVALID:?\s*/i, "");
        return { isValid: false, reason };
      }
    }
    
    // Standard relevance check
    const relevancePrompt = `Query: "${query}"
Response: "${exaResponse.substring(0, 500)}${exaResponse.length > 500 ? '...' : ''}"

IMPORTANT: Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone.
Full date: ${fullDateString}

Is this response relevant to the query? Consider ONLY:
1. Does it directly address the main subject of the query?
2. Does it provide specific information related to the query?
3. Is the information accurate as of ${formattedDate}?

IMPORTANT: If the current year is 2025 or later, DO NOT reject responses about Donald Trump being the US President, as this is accurate for our current timeline.

Answer with VALID if the response is relevant and accurate, or INVALID followed by a brief explanation of any issues.`;

    const relevanceCheck = await callAnthropicAPI(relevancePrompt, {
      mode: "generic",
      maxTokens: 100,
      systemPrompt: `You are an evaluation assistant. Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone. Your task is to verify if responses are relevant and accurate. If the current year is 2025 or later, accept responses about Donald Trump being the US President as valid.`
    });
    
    if (relevanceCheck.toUpperCase().startsWith("INVALID")) {
      const reason = relevanceCheck.replace(/^INVALID:?\s*/i, "");
      return { isValid: false, reason };
    } else {
      return { isValid: true, reason: "Response is relevant and accurate" };
    }
  } catch (error) {
    logError("Error verifying Exa response:", error);
    return { isValid: true, reason: "Verification failed, assuming response is valid" };
  }
}

// Refine query based on verification feedback
async function refineQueryBasedOnFeedback(query, feedback) {
  try {
    const formattedDate = dateUtils.getCurrentFormattedDate();
    const currentYear = dateUtils.getCurrentYear();
    
    const refinementPrompt = `Original query: "${query}"
Feedback on previous response: "${feedback}"

IMPORTANT: Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}.

Please rewrite this query to be more specific, clear, and likely to get an accurate response. 
Make sure to:
1. Specify that you want information as of ${formattedDate}
2. Clarify any ambiguous terms
3. Add specific details that would help get a better response

DO NOT add any disclaimers about knowledge cutoff dates or future events.
${formattedDate} is the CURRENT date, not a future date.

Improved query:`;

    const refinedQuery = await callAnthropicAPI(refinementPrompt, {
      mode: "generic",
      maxTokens: 100,
      systemPrompt: `You are a query refinement specialist. Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}. Your task is to rewrite queries to get the most accurate and relevant information as of the current date.`
    });
    
    // Apply date substitutions to the refined query
    return dateUtils.processQuery(refinedQuery);
  } catch (error) {
    logError("Error refining query:", error);
    return query; // Return original query if refinement fails
  }
}

// Combined function to analyze query and decide response
async function analyzeQueryAndDecideResponse(query, userId) {
  try {
    const conversation = userContextManager.getConversationString(userId);
    const formattedDate = dateUtils.getCurrentFormattedDate();
    const currentYear = dateUtils.getCurrentYear();
    
    const fullPrompt = `IMPORTANT: Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}.

Conversation context: "${conversation}"
Current query: "${query}"

First, extract all relevant subjects or details from the above information. Pay special attention to:
- Names of people, places, or things
- Time periods or dates
- Specific questions or requests
- Any context from previous messages that helps understand the current query

Then, determine the most appropriate response type based on the query:
- If the query is asking for an image or visualization, choose "image_request"
- If the query is asking for information AND an image, choose "hybrid_response"
- If the query is about current events, recent developments, or time-sensitive information, choose "exa_response"
- If the query contains words like "current", "now", "today", "latest", "present", "recent", "newest", "modern", choose "exa_response"
- If the query is about historical facts, past events, or information that doesn't change over time, choose "text_response"
- Otherwise, choose "text_response"

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
Extracted context: <the extracted subjects or details>
Response type: <text_response OR image_request OR exa_response OR hybrid_response>`;

    const response = await callAnthropicAPI(fullPrompt, {
      mode: "decide_response",
      maxTokens: 100,
      systemPrompt: `You are an analysis assistant. Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}. Your task is to analyze queries and determine the most appropriate response type. Be especially careful to:
1. Identify hybrid requests that ask a question AND request visualization
2. Route queries about current events, current officeholders, or anything that might change over time to the exa_response type
3. Classify historical facts as text_response
4. Recognize when a query contains both an information request and an image request, even if they're in separate sentences
5. Classify requests that ask to "show" something visual as image_request or hybrid_response`
    });
    
    // Extract the context and response type from the response
    const extractedContextMatch = response.match(/Extracted context: (.*?)(?:\n|$)/);
    const responseTypeMatch = response.match(/Response type: (.*?)(?:\n|$)/);
    
    const extractedContext = extractedContextMatch ? extractedContextMatch[1].trim() : "";
    const responseType = responseTypeMatch ? responseTypeMatch[1].trim() : "text_response";
    
    // Additional check for image requests - expanded to catch more patterns
    const imageRequestPatterns = [
      /show me/i,
      /show an? (image|picture|photo|visualization|drawing)/i,
      /display an? (image|picture|photo|visualization|drawing)/i,
      /see an? (image|picture|photo|visualization|drawing)/i,
      /view an? (image|picture|photo|visualization|drawing)/i,
      /(image|picture|photo|visualization|drawing) of/i,
      /draw/i,
      /sketch/i,
      /illustrate/i,
      /visualize/i,
      /create an? (image|picture|photo|visualization|drawing)/i,
      /generate an? (image|picture|photo|visualization|drawing)/i,
      /make an? (image|picture|photo|visualization|drawing)/i,
      /picture/i,
      /photo/i,
      /visual/i,
      /render/i,
      /depict/i
    ];
    
    // Check if any image request pattern matches
    const isImageRequest = imageRequestPatterns.some(pattern => pattern.test(query));
    
    // Additional check for information-seeking elements
    const isInfoRequest = query.match(/\?|who|what|when|where|why|how|current|latest|recent|today|now/) ||
                         query.toLowerCase().includes("weather") ||
                         query.toLowerCase().includes("information") ||
                         query.toLowerCase().includes("data") ||
                         query.toLowerCase().includes("richest") ||
                         query.toLowerCase().includes("poorest") ||
                         query.toLowerCase().includes("biggest") ||
                         query.toLowerCase().includes("smallest") ||
                         query.toLowerCase().includes("tallest") ||
                         query.toLowerCase().includes("shortest");
    
    // Override the response type if needed
    if (isImageRequest) {
      if (isInfoRequest) {
        console.log("Overriding to hybrid_response due to detected information + image request");
        return { extractedContext, responseType: "hybrid_response" };
      } else {
        console.log("Overriding to image_request due to detected image request");
        return { extractedContext, responseType: "image_request" };
      }
    }
    
    // Additional check for queries that should use Exa - but be more precise
    if (responseType === "text_response" && 
        (query.toLowerCase().includes("current") || 
         query.toLowerCase().includes(" now ") ||
         query.toLowerCase().includes("today") ||
         query.toLowerCase().includes("latest") ||
         query.toLowerCase().includes("recent"))) {
      console.log("Overriding to exa_response due to time-sensitive query");
      return { extractedContext, responseType: "exa_response" };
    }
    
    return { extractedContext, responseType };
  } catch (error) {
    logError("Error analyzing query:", error);
    return { extractedContext: "", responseType: "text_response" };
  }
}

// Generate hybrid response (text + image)
async function generateHybridResponse(query, extractedContext, payload) {
  try {
    console.log("Generating hybrid response (text + image)");
    
    // Split the query into information and image parts
    // First, try to identify if there's a clear separation with keywords
    const imageTriggerWords = ['imagine', 'visualize', 'picture', 'envision', 'show', 'create an image', 'what would it look like'];
    
    let infoQuery = query;
    let imageQuery = query;
    
    // Try to find the point where the image request starts
    let splitIndex = -1;
    for (const word of imageTriggerWords) {
      const index = query.toLowerCase().indexOf(word);
      if (index !== -1 && (splitIndex === -1 || index < splitIndex)) {
        splitIndex = index;
      }
    }
    
    // If we found a clear split point, separate the query
    if (splitIndex !== -1) {
      infoQuery = query.substring(0, splitIndex).trim();
      // If the info query ends with "and" or similar conjunctions, clean it up
      infoQuery = infoQuery.replace(/\b(and|then|also|plus)\s*$/i, '').trim();
      
      // Make sure the info query isn't too short or just a fragment
      if (infoQuery.length < 10 || !infoQuery.match(/\?|who|what|when|where|why|how/i)) {
        // If it's too short or doesn't look like a question, use the whole query
        infoQuery = query;
      }
    }
    
    console.log(`Information query part: "${infoQuery}"`);
    
    // Step 1: Get information from Exa
    console.log("Step 1: Getting information from Exa...");
    const exaResponse = await callExaAPIWithVerification(infoQuery, payload.userId);
    
    // Step 2: Use the information to enhance the image prompt
    console.log("Step 2: Using Exa information to enhance image prompt...");
    const imagePromptEnhancementQuery = `
Information from search: "${exaResponse || 'No specific information available'}"
Original query: "${query}"
Extracted context: "${extractedContext}"

Based on the above information, create a detailed image prompt that would generate a visually appealing and accurate image related to the query.
The prompt should:
1. Include specific details from the information provided
2. Be descriptive and visually oriented
3. Focus on the main subject of the query
4. Include relevant context, setting, and visual elements
5. Be formatted as a cohesive paragraph describing the scene

Begin with "# Image Prompt:" followed by a title, then provide the detailed description.`;

    const enhancedImagePrompt = await callAnthropicAPI(imagePromptEnhancementQuery, {
      mode: "generic",
      maxTokens: 300,
      systemPrompt: "You are an expert at creating detailed image generation prompts. Your task is to take information and create a vivid, detailed prompt that will result in an appealing and accurate image."
    });
    
    console.log(`Enhanced image prompt: ${enhancedImagePrompt}`);
    
    // Step 3: Generate the image
    console.log("Step 3: Generating image with enhanced prompt...");
    const pollingUrl = await generateFluxImage(enhancedImagePrompt);
    if (!pollingUrl) {
      console.error("Failed to get polling URL from FLUX API");
      await sendTextZoomResponse(payload, exaResponse || "I couldn't find specific information about that.");
      return;
    }
    
    // Poll for the final image
    const imageUrl = await pollForImage(pollingUrl);
    if (!imageUrl) {
      console.error("Failed to get final image URL from polling");
      await sendTextZoomResponse(payload, exaResponse || "I couldn't find specific information about that.");
      return;
    }
    
    // Send the hybrid response
    await sendHybridZoomResponse(payload, exaResponse || "I couldn't find specific information about that.", imageUrl, enhancedImagePrompt);
    
    return true;
  } catch (error) {
    logError("Error generating hybrid response:", error);
    return false;
  }
}

// Helper function to enhance image prompt with Exa information
async function enhanceImagePromptWithInfo(originalContext, exaInfo) {
  try {
    const formattedDate = dateUtils.getCurrentFormattedDate();
    
    const prompt = `I have the following information about a subject:
    
${exaInfo}

Based on this information, I want to create an image prompt about: "${originalContext}"

IMPORTANT: Today's date is ${formattedDate}. If the information appears to be from a different date, please adapt it to represent the current situation.

Extract the most relevant, current, and visual details from the information above to enhance this image prompt.
Focus on:
1. Current activities or projects
2. Visual elements that could be depicted (locations, objects, actions)
3. Recent notable events or achievements

Return only the enhanced context for the image prompt, with no additional explanation.`;

    const result = await callAnthropicAPI(prompt, {
      systemPrompt: `You are an expert at extracting visual details from text to create compelling image prompts. Today's date is ${formattedDate}. Your task is to create a current, accurate image prompt based on the most recent information available.`,
      maxTokens: 150
    });
    
    console.log(`Original context: "${originalContext}"`);
    console.log(`Enhanced context: "${result}"`);
    return result || originalContext;
  } catch (error) {
    logError('Error enhancing image prompt with info:', error);
    // In case of error, return the original context to continue the process
    return originalContext;
  }
}

// Call Exa API with verification
async function callExaAPIWithVerification(query, userId) {
  try {
    const formattedDate = dateUtils.getCurrentFormattedDate();
    const currentYear = dateUtils.getCurrentYear();
    const currentMonth = dateUtils.getCurrentMonth();
    const currentDay = dateUtils.getCurrentDay();
    
    // Get conversation context if userId is provided
    let conversationContext = "";
    if (userId) {
      conversationContext = userContextManager.getConversationString(userId);
    }
    
    // Check if query contains pronouns or references that need context
    const needsContext = /\bthey\b|\bthem\b|\btheir\b|\bthese\b|\bthose\b|\bit\b|\bits\b|\bhe\b|\bshe\b|\bhis\b|\bher\b/i.test(query);
    
    // First, check if this is an image-related query
    const imageRelatedPatterns = [
      /show me/i, /show an? (image|picture|photo|visualization|drawing)/i,
      /display an? (image|picture|photo|visualization|drawing)/i,
      /see an? (image|picture|photo|visualization|drawing)/i,
      /view an? (image|picture|photo|visualization|drawing)/i,
      /(image|picture|photo|visualization|drawing) of/i,
      /draw/i, /sketch/i, /illustrate/i, /visualize/i,
      /create an? (image|picture|photo|visualization|drawing)/i,
      /generate an? (image|picture|photo|visualization|drawing)/i,
      /make an? (image|picture|photo|visualization|drawing)/i,
      /picture/i, /photo/i, /visual/i, /render/i, /depict/i
    ];
    
    const isImageRelated = imageRelatedPatterns.some(pattern => pattern.test(query));
    
    // If it's an image-related query, extract the subject and reformulate
    let cleanedQuery = query;
    if (isImageRelated) {
      // Try to extract the subject using various patterns
      let subject = "";
      
      // Pattern 1: "draw/show/etc X of Y"
      const ofPattern = /(?:draw|show|display|see|view|create|generate|make|picture|photo|image|visualization|drawing|sketch|illustrate|visualize|render|depict)(?:\s+\w+)?\s+(?:of|about)\s+([^?.,]+)/i;
      const ofMatch = query.match(ofPattern);
      
      // Pattern 2: "draw/show/etc Y"
      const directPattern = /(?:draw|show|display|see|view|create|generate|make|picture|photo|image|visualization|drawing|sketch|illustrate|visualize|render|depict)\s+(?:a|an|the)?\s+([^?.,]+)/i;
      const directMatch = query.match(directPattern);
      
      // Use the first successful match
      if (ofMatch) {
        subject = ofMatch[1].trim();
      } else if (directMatch) {
        subject = directMatch[1].trim();
      }
      
      // If we found a subject, reformulate the query
      if (subject) {
        // Check if the subject contains time-related terms
        const hasTimeContext = /current|latest|recent|today|now|present|newest|modern/i.test(subject);
        
        if (hasTimeContext) {
          cleanedQuery = `What is the most up-to-date information about ${subject} as of ${formattedDate}?`;
        } else {
          cleanedQuery = `Who or what is ${subject} as of ${formattedDate}?`;
        }
        
        // If the subject contains superlatives, use a more specific query
        if (/richest|poorest|biggest|smallest|tallest|shortest|fastest|slowest|oldest|youngest|best|worst/i.test(subject)) {
          cleanedQuery = `What is the most current information about ${subject} as of ${formattedDate}?`;
        }
        
        console.log(`Reformulated image query to information query: "${cleanedQuery}"`);
      }
    }
    
    // Enhance query with context if needed
    let enhancedQuery = cleanedQuery;
    if (needsContext && conversationContext) {
      console.log("Query contains references that need context, enhancing with conversation history");
      
      const contextPrompt = `
Original query: "${cleanedQuery}"
Recent conversation context: "${conversationContext}"

IMPORTANT: Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone.

The original query contains references (like "they", "them", "these", etc.) that require context from the conversation.
Please rewrite the query to be self-contained and explicit, replacing all pronouns and references with their specific subjects.
Make the query clear and complete so it can be understood without any additional context.
Include the current date in the query if it's asking about current information.

IMPORTANT: Exa is a search API that can only provide information, not generate or return images. 
Rewrite the query to ask only for information, not for images or visualizations.

Rewritten query:`;

      enhancedQuery = await callAnthropicAPI(contextPrompt, {
        mode: "generic",
        maxTokens: 150,
        systemPrompt: `You are a query enhancement specialist. Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone. Your task is to rewrite queries to be self-contained and explicit, replacing all pronouns and references with their specific subjects. Remember that Exa is a search API that can only provide information, not generate or return images.`
      });
      
      console.log(`Enhanced query for Exa: "${enhancedQuery}"`);
    }
    
    // Call Exa API
    console.log(`Calling Exa API with query: "${enhancedQuery}"`);
    const exaResponse = await callExaAPI(enhancedQuery);
    
    if (!exaResponse) {
      console.log("No response from Exa API");
      return null;
    }
    
    console.log(`Exa API response: "${exaResponse.substring(0, 100)}..."`);
    
    // Verify the response
    const { isValid, reason } = await verifyExaResponse(exaResponse, enhancedQuery);
    console.log(`Exa response verified as ${isValid ? 'valid' : 'invalid'}: ${reason}`);
    
    if (isValid) {
      return exaResponse;
    } else {
      // If the response is invalid, try to generate a corrected response
      console.log(`Generating corrected response for invalid Exa result: ${reason}`);
      
      // For all cases, try to correct the response
      const correctionPrompt = `
Query: "${enhancedQuery}"
Original response (which contains errors): "${exaResponse.substring(0, 500)}${exaResponse.length > 500 ? '...' : ''}"
Error identified: ${reason}

IMPORTANT: Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone.

Please provide a corrected response that:
1. Addresses the original query accurately
2. Fixes the identified error
3. Ensures all information is current as of ${formattedDate}
4. Is factually accurate

Your response should be concise and directly answer the query.`;

      const correctedResponse = await callAnthropicAPI(correctionPrompt, {
        mode: "generic",
        maxTokens: 500,
        systemPrompt: `You are a fact-checking assistant. Today's ACTUAL date is ${formattedDate} (${currentMonth} ${currentDay}, ${currentYear}) in UTC timezone. Your task is to correct responses that contain outdated or inaccurate information.`
      });
      
      return correctedResponse;
    }
  } catch (error) {
    logError("Error calling Exa API with verification:", error);
    return null;
  }
}

module.exports = {
  generateTextResponse,
  generateImageResponse,
  generateHybridResponse,
  callExaAPIWithVerification,
  analyzeQueryAndDecideResponse,
  enhanceImagePromptWithInfo
};