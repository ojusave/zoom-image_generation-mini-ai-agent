const axios = require('axios');
const { API_CONFIG } = require('../config/config');
const { logError } = require('../utils/utils');

// Poll for image from FLUX API
async function pollForImage(pollingUrl) {
  console.log(`Polling FLUX API for final image: ${pollingUrl}`);
  
  const maxAttempts = 10;
  let delay = 2000; // Start with 2 seconds
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(pollingUrl, {
        headers: { 'X-Key': process.env.FLUX_SECRET_TOKEN }
      });
      
      if (response.data?.result?.sample) {
        console.log(`Final Image URL: ${response.data.result.sample} (found on attempt ${attempt})`);
        return response.data.result.sample;
      }
      
      console.log(`Attempt ${attempt}: Image not ready yet, waiting ${delay/1000} seconds...`);
    } catch (error) {
      console.log(`Polling attempt ${attempt} failed:`, error.response ? error.response.status : error.message);
      // Don't give up on network errors, just retry
    }
    
    // Wait with exponential backoff
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 15000); // Increase delay up to max 15 seconds
  }
  
  console.log("Image polling timeout - maximum attempts reached");
  return null;
}

// Call FLUX API to generate an image
async function generateFluxImage(prompt, width = 1024, height = 768) {
  try {
    const requestData = {
      prompt,
      width,
      height,
      prompt_upsampling: false,
      seed: 42,
      safety_tolerance: 2,
      output_format: "jpeg"
    };
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Key': process.env.FLUX_SECRET_TOKEN
    };
    
    const response = await axios.post(API_CONFIG.FLUX_URL, requestData, { headers });
    console.log('FLUX API Response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.polling_url) {
      return response.data.polling_url;
    }
    return null;
  } catch (error) {
    logError('Error calling FLUX API:', error);
    return null;
  }
}

module.exports = {
  pollForImage,
  generateFluxImage
}; 