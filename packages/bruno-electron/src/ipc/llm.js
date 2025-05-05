const { ipcMain, dialog } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs/promises');
const fsSync = require('fs');
const { GoogleGenAI } = require('@google/genai');

// LLM Configuration
const llmConfig = {
  defaultProvider: 'vertex', // Can be 'azure', 'groq', or 'vertex'
  azure: {
    endpoint:
      process.env.AZURE_LLM_ENDPOINT ||
      'https://finetuned-model-euwyrqwq.southcentralus.models.ai.azure.com/v1/chat/completions',
    apiKey: process.env.AZURE_API_KEY || ''
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct' // Default Groq model, user-provided one seems experimental
  },
  vertex: {
    projectId: process.env.GOOGLE_PROJECT_ID || '',
    location: process.env.GOOGLE_LOCATION || 'us-east5',
    model: process.env.GOOGLE_MODEL || 'meta/llama-4-maverick-17b-128e-instruct-maas'
  }
};

/**
 * Call Azure LLM API specific function
 * @param {string} fileContent - C# controller file content
 * @param {string} systemPrompt - The system prompt
 * @returns {Promise<Array>} - Array of generated Bruno request file contents
 */
async function callAzureLlmApi(fileContent, systemPrompt) {
  if (!llmConfig.azure.apiKey) {
    throw new Error('Azure API key not found. Please set AZURE_API_KEY in environment variables.');
  }

  const payload = {
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: fileContent
      }
    ],
    temperature: 0.1,
    top_p: 0.8,
    top_k: 40, // Note: top_k might not be supported by all models/APIs
    max_tokens: 64000 // Increased token limit for potentially large responses
  };

  try {
    console.log('Calling Azure LLM API...');
    const response = await axios.post(llmConfig.azure.endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.azure.apiKey}`
      }
    });

    // Log response structure for debugging
    console.log(
      'Azure LLM API Response Status:',
      JSON.stringify({
        status: response.status,
        hasChoices: !!response.data.choices,
        choiceCount: response.data.choices?.length
      })
    );

    if (!response.data.choices || response.data.choices.length === 0 || !response.data.choices[0].message) {
      console.error('Invalid Azure response structure:', response.data);
      throw new Error('Empty or invalid response from Azure LLM API');
    }

    let content = response.data.choices[0].message.content;
    return parseLlmResponse(content, 'Azure'); // Use a helper for parsing
  } catch (error) {
    console.error('Azure LLM API call failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`Azure LLM API call failed: ${error.message}`);
  }
}

/**
 * Helper function to parse LLM response content (potentially JSON wrapped in markdown)
 * @param {string} content - Raw content string from LLM response
 * @param {string} providerName - Name of the provider for logging
 * @returns {Promise<Array>} - Parsed endpoints array
 */
async function parseLlmResponse(content, providerName) {
  try {
    console.log(`Raw content from ${providerName}:`, content);

    // Clean up the content before parsing
    let cleanedContent = content.trim();

    // Remove any prefixes like "Here is the JSON output:"
    const jsonStartIndex = cleanedContent.indexOf('{');
    if (jsonStartIndex > 0) {
      console.log(`Removing prefix text from ${providerName} response...`);
      cleanedContent = cleanedContent.substring(jsonStartIndex);
    }

    // Clean up markdown formatting (```json ... ```)
    if (cleanedContent.includes('```')) {
      console.log(`Removing markdown code blocks from ${providerName} response...`);
      cleanedContent = cleanedContent.replace(/^```(?:json)?[\r\n]?/, '').replace(/[\r\n]?```$/, '');
    }

    // Attempt to find where the actual JSON ends (in case there's trailing text)
    const lastBraceIndex = cleanedContent.lastIndexOf('}');
    if (lastBraceIndex > 0 && lastBraceIndex < cleanedContent.length - 1) {
      console.log(`Trimming trailing text after JSON from ${providerName} response...`);
      cleanedContent = cleanedContent.substring(0, lastBraceIndex + 1);
    }

    // Attempt to parse as JSON
    const parsed = JSON.parse(cleanedContent);

    if (!parsed.endpoints || !Array.isArray(parsed.endpoints)) {
      console.error(`Invalid response format from ${providerName}: missing endpoints array. Parsed:`, parsed);
      throw new Error('Invalid response format: missing endpoints array');
    }

    return parsed.endpoints;
  } catch (jsonError) {
    console.error(`Failed to parse LLM response from ${providerName} as JSON:`, jsonError);
    console.error('Original content received:', content);
    throw new Error(`Failed to parse LLM response from ${providerName}: ${jsonError.message}`);
  }
}

/**
 * Call Groq LLM API specific function
 * @param {string} fileContent - C# controller file content
 * @param {string} systemPrompt - The system prompt
 * @returns {Promise<Array>} - Array of generated Bruno request file contents
 */
async function callGroqLlmApi(fileContent, systemPrompt) {
  if (!llmConfig.groq.apiKey) {
    throw new Error('Groq API key not found. Please set GROQ_API_KEY in environment variables.');
  }

  const payload = {
    model: llmConfig.groq.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: fileContent }
    ],
    temperature: 0.1, // Matching Azure settings
    max_tokens: 4000, // Matching Azure settings
    top_p: 0.8 // Matching Azure settings
    // stream: false, // Default
    // stop: null // Default
  };

  try {
    console.log(`Calling Groq LLM API (Model: ${llmConfig.groq.model})...`);
    const response = await axios.post(llmConfig.groq.endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.groq.apiKey}`
      }
    });

    // Log response structure for debugging
    console.log(
      'Groq LLM API Response Status:',
      JSON.stringify({
        status: response.status,
        hasChoices: !!response.data.choices,
        choiceCount: response.data.choices?.length
      })
    );

    if (!response.data.choices || response.data.choices.length === 0 || !response.data.choices[0].message) {
      console.error('Invalid Groq response structure:', response.data);
      throw new Error('Empty or invalid response from Groq LLM API');
    }

    let content = response.data.choices[0].message.content;
    return parseLlmResponse(content, 'Groq'); // Use the helper for parsing
  } catch (error) {
    console.error('Groq LLM API call failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`Groq LLM API call failed: ${error.message}`);
  }
}

/**
 * Call Google Vertex AI API specific function
 * @param {string} fileContent - C# controller file content
 * @param {string} systemPrompt - The system prompt
 * @returns {Promise<Array>} - Array of generated Bruno request file contents
 */
async function callVertexLlmApi(fileContent, systemPrompt) {
  if (!llmConfig.vertex.projectId) {
    throw new Error('Google Project ID not found. Please set GOOGLE_PROJECT_ID in environment variables.');
  }

  try {
    console.log(`Calling Google Vertex AI (Model: ${llmConfig.vertex.model})...`);

    // Initialize the Google GenAI client
    const genAI = new GoogleGenAI({
      vertexai: true,
      project: llmConfig.vertex.projectId,
      location: llmConfig.vertex.location,
      googleAuthOptions: {
        credentials: process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : undefined
      }
    });

    // Create content request with system prompt and user content
    const response = await genAI.models.generateContent({
      model: llmConfig.vertex.model,
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nHere is the C# controller code to analyze:\n\n${fileContent}` }]
        }
      ],
      config: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8000,
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: false
        },
        responseModalities: ['TEXT']
      }
    });

    // Extract and parse the response
    console.log('Vertex AI response received.');

    // Get the text response
    const content = response.text;

    // Parse the content
    return parseLlmResponse(content, 'Vertex AI');
  } catch (error) {
    console.error('Google Vertex AI call failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`Google Vertex AI call failed: ${error.message}`);
  }
}

/**
 * Main dispatcher function to call the configured LLM provider
 * @param {string} fileContent - C# controller file content
 * @returns {Promise<Array>} - Array of generated Bruno request file contents
 */
async function callLlmApi(fileContent) {
  const provider = llmConfig.defaultProvider;
  console.log(`Using LLM provider: ${provider}`);

  switch (provider) {
    case 'azure':
      return callAzureLlmApi(fileContent, systemPrompt);
    case 'groq':
      return callGroqLlmApi(fileContent, systemPrompt);
    case 'vertex':
      return callVertexLlmApi(fileContent, systemPrompt);
    default:
      throw new Error(`Unsupported LLM provider configured: ${provider}`);
  }
}

// System prompt remains the same for both providers for now
const systemPrompt = `You are an expert API parser that converts C# ASP.NET Core API controllers into Bruno API collection files.

TASK:
Analyze the C# controller code and extract each API endpoint. For each endpoint, create a Bruno API request file.

IMPORTANT OUTPUT FORMAT:
Your response must be valid JSON in the following format:
{
  "endpoints": [
    {
      "name": "Endpoint name", 
      "method": "GET|POST|PUT|DELETE|etc",
      "path": "Full relative path including route prefix",
      "auth": "none|bearer|inherit",
      "contentType": "application/json|etc",
      "description": "Brief description of the endpoint",
      "bodyExample": "Example body or null if no body needed",
      "bruFile": "Complete Bruno file content for this endpoint (MUST BE TEXT, NOT JSON)"
    }
  ]
}

BRUNO FILE FORMAT FOR 'bruFile' FIELD:
Each 'bruFile' field MUST contain ONLY the raw text content matching this structure:

meta {
  name: [Endpoint Name]
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}[PATH]
  auth: none
}

post {
  url: {{baseUrl}}[PATH]
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  [BODY CONTENT]
}

RULES:
1. Extract proper HTTP method from attributes like [HttpGet], [HttpPost], etc.
2. HTTP methods in Bruno format MUST be lowercase (get, post, put, delete, etc.)
3. Include the full route by combining the controller's [Route] attribute with the method's route.
4. If [AllowAnonymous] is present, use "auth: none", otherwise use "auth: bearer". Include the bearer auth section if needed.
5. For POST/PUT methods that accept a body, include a "body:json" section with the content from "bodyExample".
6. Use {{baseUrl}} as the base URL variable in the request URL.
7. Check for [Produces] attribute to determine content type (affects body section).
8. DO NOT use the markdown format with \`\`\` in the bruFile field.
9. Do NOT include example 

ABSOLUTELY DO NOT wrap your response in markdown code blocks (like \`\`\`json).
Return ONLY the raw JSON object. Do not include ANY introductory text, preamble, or explanation like "Here is the JSON output:". Your response must start directly with "{" and end directly with "}".
THE 'bruFile' FIELD MUST CONTAIN A STRING WITH THE BRUNO TEXT FORMAT, NOT A JSON STRING. DO NOT INCLUDE ANYTHING OTHER THAN THE JSON OUTPUT.`;

/**
 * Save generated Bruno request files to the collection
 * @param {Array} endpoints - Array of endpoint objects from LLM
 * @param {string} collectionUid - Collection UID to save files to
 * @param {string} controllerFileName - Name of the original controller file
 * @param {Electron.WebContents} sender - IPC event sender to send messages back to renderer
 * @returns {Promise<Array>} - Array of saved file paths
 */
async function saveGeneratedFiles(endpoints, collectionUid, controllerFileName, sender) {
  console.log(`Saving ${endpoints.length} generated files to collection ${collectionUid}`);

  try {
    // We need to query the renderer process to get the collection path from the UID
    // Create a promise that will be resolved when we get the response
    return new Promise((resolve, reject) => {
      // Create an event listener specifically for this request
      const responseHandler = (event, data) => {
        if (data && data.collectionUid === collectionUid) {
          ipcMain.removeListener('renderer:collection-path-response', responseHandler);

          if (data.error) {
            console.error('Error getting collection path:', data.error);
            reject(new Error(data.error));
            return;
          }

          const collectionPath = data.collectionPath;
          if (!collectionPath) {
            reject(new Error('Collection path not found'));
            return;
          }

          processEndpoints(endpoints, collectionPath, controllerFileName).then(resolve).catch(reject);
        }
      };

      // Register the event listener
      ipcMain.on('renderer:collection-path-response', responseHandler);

      // Request the collection path from the renderer process
      setTimeout(() => {
        ipcMain.removeListener('renderer:collection-path-response', responseHandler);
        reject(new Error('Timeout getting collection path'));
      }, 10000); // 10 second timeout

      console.log('Requesting collection path for:', collectionUid);

      // Use the sender (renderer that initiated the request) to send message back
      sender.send('main:get-collection-path', { collectionUid });
    });
  } catch (error) {
    console.error('Error in saveGeneratedFiles:', error);
    throw error;
  }
}

/**
 * Process and save endpoints as .bru files
 * @param {Array} endpoints - Endpoints from LLM
 * @param {string} collectionPath - Path to the collection
 * @param {string} controllerFileName - Name of the controller file
 * @returns {Promise<Array>} - Saved files info
 */
async function processEndpoints(endpoints, collectionPath, controllerFileName) {
  try {
    // Create a folder for this controller
    const controllerName = path.basename(controllerFileName, '.cs');
    const folderPath = path.join(collectionPath, controllerName);

    // Ensure the folder exists
    try {
      await fs.mkdir(folderPath, { recursive: true });

      // Create a folder.bru file to store metadata
      const folderBru = `meta {
  name: ${controllerName}
  type: folder
}`;
      await fs.writeFile(path.join(folderPath, 'folder.bru'), folderBru, 'utf8');
      console.log(`Created folder at ${folderPath}`);
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      console.log(`Folder already exists at ${folderPath}`);
    }

    // Now save each endpoint as a .bru file
    const savedFiles = [];

    console.log(`Saving ${endpoints.length} endpoints to ${folderPath}`);

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];

      // Create a safe filename based on the endpoint name
      const sanitizedName = endpoint.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${sanitizedName}.bru`;
      const filePath = path.join(folderPath, filename);

      console.log(`Writing file: ${filePath}`);

      try {
        // Clean up the bruFile content
        let bruContent = endpoint.bruFile;

        // Remove markdown code blocks if present
        if (bruContent.includes('```bruno')) {
          bruContent = bruContent.replace(/```bruno\n/, '').replace(/```\s*$/, '');
        }

        // Make sure HTTP methods are lowercase
        bruContent = bruContent.replace(/\n(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) {/gi, (match) => {
          return match.toLowerCase();
        });

        // Fix the HTTP method format if it appears at the start of a line
        // This is a common issue in the generated files
        bruContent = bruContent.replace(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) {/gim, (match) => {
          return match.toLowerCase();
        });

        // Ensure Bruno format has consistent method declarations
        bruContent = bruContent.replace(/^([a-z]+) {/gm, (match, method) => {
          // Convert the method to the explicit keyword format that Bruno expects
          return method.toLowerCase() + ' {';
        });

        // Write the .bru file content
        await fs.writeFile(filePath, bruContent, 'utf8');

        savedFiles.push({
          name: endpoint.name,
          method: endpoint.method,
          path: endpoint.path,
          filePath: filePath,
          saved: true
        });

        console.log(`Successfully wrote: ${filePath}`);
      } catch (fileErr) {
        console.error(`Error writing file ${filePath}:`, fileErr);
        savedFiles.push({
          name: endpoint.name,
          method: endpoint.method,
          path: endpoint.path,
          filePath: filePath,
          saved: false,
          error: fileErr.message
        });
      }
    }

    return savedFiles;
  } catch (error) {
    console.error('Error saving endpoint files:', error);
    throw error;
  }
}

const registerLlmIpc = (mainWindow) => {
  ipcMain.on('generate-requests-from-controller', async (event, { collectionUid }) => {
    if (!collectionUid) {
      console.error('Collection UID is required to generate requests.');
      event.sender.send('generate-requests-result', {
        success: false,
        error: 'Collection UID not provided.'
      });
      return;
    }

    console.log(`Received generate request for collection: ${collectionUid}`);

    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select C# Controller File',
        properties: ['openFile'],
        filters: [{ name: 'C# Files', extensions: ['cs'] }]
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        console.log('File selection canceled.');
        // Notify the renderer that the process was cancelled
        event.sender.send('generate-requests-cancelled');
        return;
      }

      const filePath = result.filePaths[0];
      const controllerFileName = path.basename(filePath);
      console.log(`Selected controller file: ${filePath}`);

      const fileContent = await fs.readFile(filePath, 'utf-8');
      console.log(`Read ${fileContent.length} characters from controller file.`);

      // Send interim update to UI
      event.sender.send('generate-requests-result', {
        success: true,
        interim: true,
        message: 'Processing with AI...'
      });

      try {
        // Call LLM API to parse controller and generate Bruno requests
        const endpoints = await callLlmApi(fileContent);
        console.log(`LLM generated ${endpoints.length} endpoints`);

        // Send status before saving files
        event.sender.send('generate-requests-result', {
          success: true,
          interim: true,
          message: 'Saving generated requests...'
        });

        // Save the generated files to the collection, passing event.sender
        const savedFiles = await saveGeneratedFiles(endpoints, collectionUid, controllerFileName, event.sender);

        // Send success result with details
        event.sender.send('generate-requests-result', {
          success: true,
          message: `Generated ${endpoints.length} API requests from controller`,
          endpoints: savedFiles
        });
      } catch (processError) {
        console.error('Error processing file:', processError);
        event.sender.send('generate-requests-result', {
          success: false,
          error: processError.message || 'Unknown error during processing'
        });
      }
    } catch (error) {
      console.error('Error processing controller file:', error);
      event.sender.send('generate-requests-result', {
        success: false,
        error: `Error processing controller file: ${error.message}`
      });
    }
  });
};

module.exports = registerLlmIpc;
