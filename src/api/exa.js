const axios = require('axios');
const { logError } = require('../utils/utils');
const { dateUtils } = require('../utils/utils');
const { improvePrompt } = require('./anthropic');

// Process and improve Exa query
async function improveExaQuery(originalQuery) {
  const improvedQuery = await improvePrompt(originalQuery, "exa");
  // Apply date substitutions
  return dateUtils.processQuery(improvedQuery || originalQuery);
}

// Function to call Exa API for search and aggregate streamed results
async function callExaAPI(query) {
  try {
    // Improve the query for better up-to-date results
    const improvedQuery = await improveExaQuery(query);
    const payload = {
      model: "exa",
      messages: [{ role: "user", content: improvedQuery }],
      stream: true,
      extra_body: { text: true }
    };

    const response = await axios.post('https://api.exa.ai/chat/completions', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXA_API_KEY}`
      },
      responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
      let finalResponse = "";
      let buffer = "";
      
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (let line of lines) {
          line = line.trim();
          if (!line || !line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          
          try {
            const jsonData = JSON.parse(dataStr);
            if (
              jsonData.choices &&
              jsonData.choices[0] &&
              jsonData.choices[0].delta &&
              jsonData.choices[0].delta.content
            ) {
              finalResponse += jsonData.choices[0].delta.content;
            }
          } catch (err) {
            console.error('Error parsing JSON from Exa API chunk:', err);
          }
        }
      });

      response.data.on('end', () => {
        resolve(finalResponse.trim());
      });

      response.data.on('error', (err) => {
        console.error('Error in Exa API stream:', err);
        reject(err);
      });
    });
  } catch (error) {
    logError('Error calling Exa API:', error);
    return null;
  }
}

module.exports = {
  callExaAPI,
  improveExaQuery
}; 