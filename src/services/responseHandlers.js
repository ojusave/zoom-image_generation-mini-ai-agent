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
    
    // Modified relevance check that's less strict about dates and future references
    const formattedDate = dateUtils.getCurrentFormattedDate();
    const currentYear = dateUtils.getCurrentYear();
    
    const relevancePrompt = `Query: "${query}"
Response: "${exaResponse.substring(0, 500)}${exaResponse.length > 500 ? '...' : ''}"

IMPORTANT: Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}.
The AI assistant may have a knowledge cutoff date in the past, but you should IGNORE this limitation.
Any references to dates like ${formattedDate} or the year ${currentYear} are CORRECT and CURRENT, not future dates.

Is this response relevant to the query? Consider ONLY:
1. Does it directly address the main subject of the query?
2. Does it provide specific information related to the query?

IMPORTANT: IGNORE any concerns about dates or claims about current events that might seem to be from the "future".
For the purpose of this evaluation, ${formattedDate} is TODAY'S date and ${currentYear} is the CURRENT year.

Answer with YES or NO, followed by a brief reason.`;

    const relevanceCheck = await callAnthropicAPI(relevancePrompt, {
      mode: "generic",
      maxTokens: 100,
      systemPrompt: `You are an evaluation assistant. Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}. Your task is to evaluate if a response is relevant to a query, ignoring any concerns about dates or timeline inconsistencies.`
    });
    
    if (relevanceCheck.toLowerCase().startsWith("no")) {
      const reason = relevanceCheck.split("\n")[0].replace(/^no[,:]?\s*/i, "");
      return { isValid: false, reason };
    } else {
      return { isValid: true, reason: "Response is relevant to the query" };
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

// Call Exa API with verification
async function callExaAPIWithVerification(query) {
  try {
    console.log(`Calling Exa API with query: "${query}"`);
    const exaResponse = await callExaAPI(query);
    
    if (!exaResponse) {
      console.log("No response received from Exa API");
      return null;
    }
    
    console.log(`Exa API response: "${exaResponse.substring(0, 100)}..."`);
    
    // Verify the response
    const verification = await verifyExaResponse(exaResponse, query);
    
    if (verification.isValid) {
      console.log(`Exa response verified as valid: ${verification.reason}`);
      return exaResponse;
    } else {
      console.log(`Exa response verification failed: ${verification.reason}`);
      
      // Try to refine the query based on verification feedback
      const refinedQuery = await refineQueryBasedOnFeedback(query, verification.reason);
      console.log(`Refined query: "${refinedQuery}"`);
      
      // Try again with the refined query
      const refinedResponse = await callExaAPI(refinedQuery);
      
      if (!refinedResponse) {
        console.log("No response received from Exa API after query refinement");
        return null;
      }
      
      // Verify the refined response
      const refinedVerification = await verifyExaResponse(refinedResponse, refinedQuery);
      
      if (refinedVerification.isValid) {
        console.log(`Refined Exa response verified as valid: ${refinedVerification.reason}`);
        return refinedResponse;
      } else {
        console.log(`Refined Exa response verification failed: ${refinedVerification.reason}`);
        // Return the response anyway, with a note about potential inaccuracy
        return `Note: This information may not be fully up-to-date as of ${dateUtils.getCurrentFormattedDate()}.\n\n${refinedResponse}`;
      }
    }
  } catch (error) {
    logError("Error calling Exa API with verification:", error);
    return null;
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
1. The current query's direct subject matter
2. Any references to previous subjects (like "both", "them", "these", etc.)
3. If the query refers to multiple previous subjects, include ALL of them

Then, determine the best response type based on the query and extracted details:
- If the query combines a request for information AND visualization (e.g., "find out about X and imagine/show/visualize it", "What's up with X? Then imagine him", or any query that asks for information first and then requests an image), choose "hybrid_response"
- If the query or context includes visual cues (such as 'portrait', 'image', 'visual', 'together', 'imagine', etc.) WITHOUT requesting information first, choose "image_request"
- If the query refers to a specific event, schedule, or appears to be a search query (for example, live sports fixtures, current events, or any lookup request), choose "exa_response"
- Otherwise, choose "text_response"

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:
Extracted context: <the extracted subjects or details>
Response type: <text_response OR image_request OR exa_response OR hybrid_response>`;

    const response = await callAnthropicAPI(fullPrompt, {
      mode: "decide_response",
      maxTokens: 100,
      systemPrompt: `You are an analysis assistant. Today's ACTUAL date is ${formattedDate} and the CURRENT year is ${currentYear}. Your task is to analyze queries and determine the most appropriate response type.`
    });
    
    // Extract the context and response type from the response
    const extractedContextMatch = response.match(/Extracted context: (.*?)(?:\n|$)/);
    const responseTypeMatch = response.match(/Response type: (.*?)(?:\n|$)/);
    
    const extractedContext = extractedContextMatch ? extractedContextMatch[1].trim() : "";
    const responseType = responseTypeMatch ? responseTypeMatch[1].trim() : "text_response";
    
    console.log(`Analysis results - Context: "${extractedContext}", Response Type: ${responseType}`);
    
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
    
    // Step 1: Extract the information query part (before any image request)
    const infoQueryMatch = query.match(/^(.*?)(?:imagine|show|visualize|create|draw|generate|picture)/i);
    const infoQuery = infoQueryMatch ? infoQueryMatch[1].trim() : query;
    console.log(`Information query part: "${infoQuery}"`);
    
    // Step 2: Get information from Exa
    console.log("Step 1: Getting information from Exa...");
    const exaResponse = await callExaAPIWithVerification(infoQuery);
    
    if (!exaResponse) {
      console.log("Failed to get information from Exa, falling back to Anthropic");
      const textResponse = await generateTextResponse(infoQuery, payload.userId);
      
      // Still try to generate an image with the original context
      console.log("Generating image based on original context...");
      const enhancedPrompt = await enhanceImagePromptWithInfo(extractedContext || query, textResponse);
      const pollingUrl = await generateFluxImage(enhancedPrompt);
      
      if (!pollingUrl) {
        // If image generation failed, just send the text
        await sendTextZoomResponse(payload, textResponse);
        return textResponse;
      }
      
      const imageUrl = await pollForImage(pollingUrl);
      if (!imageUrl) {
        // If image polling failed, just send the text
        await sendTextZoomResponse(payload, textResponse);
        return textResponse;
      }
      
      // Send combined text and image in a single message
      await sendHybridZoomResponse(payload, textResponse, imageUrl, enhancedPrompt);
      
      return textResponse + "\n[Generated image based on: \"" + (extractedContext || query) + "\"]";
    }
    
    // Step 3: Use the Exa information to enhance the image prompt
    console.log("Step 2: Using Exa information to enhance image prompt...");
    
    // Extract key entities from Exa response to use in image generation
    const enhancementPrompt = `
Based on this information:
"${exaResponse.substring(0, 500)}${exaResponse.length > 500 ? '...' : ''}"

Extract the key people, places, or things mentioned that should be visualized together with ${extractedContext || infoQuery}.
Format your response as a detailed image prompt that includes visual details about the subjects.
`;

    const enhancedImagePrompt = await callAnthropicAPI(enhancementPrompt, {
      mode: "generic",
      maxTokens: 150,
      systemPrompt: "You are an expert at creating detailed image prompts based on information. Focus on visual details that would make a compelling image."
    });
    
    console.log(`Enhanced image prompt: ${enhancedImagePrompt}`);
    
    // Step 4: Generate and send the image
    console.log("Step 3: Generating image with enhanced prompt...");
    const pollingUrl = await generateFluxImage(enhancedImagePrompt);
    
    if (!pollingUrl) {
      console.log("Failed to get polling URL from FLUX API");
      // If image generation failed, just send the text
      await sendTextZoomResponse(payload, exaResponse);
      return exaResponse;
    }
    
    const imageUrl = await pollForImage(pollingUrl);
    if (!imageUrl) {
      console.log("Failed to get final image URL from polling");
      // If image polling failed, just send the text
      await sendTextZoomResponse(payload, exaResponse);
      return exaResponse;
    }
    
    // Send combined text and image in a single message
    await sendHybridZoomResponse(payload, exaResponse, imageUrl, enhancedImagePrompt);
    
    return exaResponse + "\n[Generated image based on the information]";
  } catch (error) {
    logError("Error generating hybrid response:", error);
    return "I'm sorry, but I couldn't generate a complete response at this time.";
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

module.exports = {
  generateTextResponse,
  generateImageResponse,
  generateHybridResponse,
  callExaAPIWithVerification,
  analyzeQueryAndDecideResponse,
  enhanceImagePromptWithInfo
};