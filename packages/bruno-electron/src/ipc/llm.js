const { ipcMain, dialog } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs/promises');
const fsSync = require('fs');

// Azure LLM configuration
const azureConfig = {
  endpoint: 'https://finetuned-model-euwyrqwq.southcentralus.models.ai.azure.com/v1/chat/completions',
  apiKey: process.env.AZURE_API_KEY || ''
};

/**
 * Call Azure LLM API to parse controller code and generate Bruno API requests
 * @param {string} fileContent - C# controller file content
 * @returns {Promise<Array>} - Array of generated Bruno request file contents
 */
async function callLlmApi(fileContent) {
  if (!azureConfig.apiKey) {
    throw new Error('Azure API key not found. Please set AZURE_API_KEY in environment variables.');
  }

  const systemPrompt = `You are an expert API parser that converts C# ASP.NET Core API controllers into Bruno API collection files.\\n\\nTASK:\\nAnalyze the C# controller code and extract each API endpoint. For each endpoint, create a Bruno API request file.\\n\\nIMPORTANT OUTPUT FORMAT:\\nYour response must be valid JSON in the following format:\\n{\\n  \"endpoints\": [\\n    {\\n      \"name\": \"Endpoint name\", \\n      \"method\": \"GET|POST|PUT|DELETE|etc\",\\n      \"path\": \"Full relative path including route prefix\",\\n      \"auth\": \"none|bearer|inherit\",\\n      \"contentType\": \"application/json|etc\",\\n      \"description\": \"Brief description of the endpoint\",\\n      \"bodyExample\": \"Example body or null if no body needed\",\\n      \"responseExample\": \"Example response based on return statement\",\\n      \"bruFile\": \"Complete Bruno file content for this endpoint (MUST BE TEXT, NOT JSON)\"\\n    }\\n  ]\\n}\\n\\nBRUNO FILE FORMAT FOR 'bruFile' FIELD:\\nEach 'bruFile' field MUST contain ONLY the raw text content matching this structure:\\n\\nmeta {\\n  name: [Endpoint Name]\\n  type: http\\n  seq: 1\\n}\\n\\nget {\\n  url: {{baseUrl}}[PATH]\\n  auth: none\\n}\\n\\npost {\\n  url: {{baseUrl}}[PATH]\\n  body: json\\n  auth: bearer\\n}\\n\\nauth:bearer {\\n  token: {{token}}\\n}\\n\\nbody:json {\\n  [BODY CONTENT]\\n}\\n\\nRULES:\\n1. Extract proper HTTP method from attributes like [HttpGet], [HttpPost], etc.\\n2. HTTP methods in Bruno format MUST be lowercase (get, post, put, delete, etc.)\\n3. Include the full route by combining the controller's [Route] attribute with the method's route.\\n4. If [AllowAnonymous] is present, use \"auth: none\", otherwise use \"auth: bearer\". Include the bearer auth section if needed.\\n5. For POST/PUT methods that accept a body, include a \"body:json\" section with the content from \"bodyExample\".\\n6. Use {{baseUrl}} as the base URL variable in the request URL.\\n7. Check for [Produces] attribute to determine content type (affects body section).\\n8. DO NOT use the markdown format with \\\`\\\`\\\` in the bruFile field.\\n\\nDO NOT wrap your response in markdown code blocks (like \\\`\\\`\\\`json). Return ONLY the raw JSON object described above.\\nTHE 'bruFile' FIELD MUST CONTAIN A STRING WITH THE BRUNO TEXT FORMAT, NOT A JSON STRING.`;

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
    top_k: 40,
    max_tokens: 4000
  };

  try {
    console.log('Calling Azure LLM API...');
    const response = await axios.post(azureConfig.endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${azureConfig.apiKey}`
      }
    });

    // Log response structure for debugging
    console.log(
      'LLM API Response:',
      JSON.stringify({
        status: response.status,
        hasChoices: !!response.data.choices,
        choiceCount: response.data.choices?.length
      })
    );

    if (!response.data.choices || response.data.choices.length === 0) {
      throw new Error('Empty response from Azure LLM API');
    }

    let content = response.data.choices[0].message.content;

    try {
      // First, log the raw content for debugging
      console.log('Raw content:', content);

      // Check if content is wrapped in markdown code blocks and extract the JSON
      if (content.trim().startsWith('```')) {
        // Find the first ``` and the last ```
        const startIndex = content.indexOf('{');
        const endIndex = content.lastIndexOf('}');

        if (startIndex !== -1 && endIndex !== -1) {
          // Extract only the JSON part
          content = content.substring(startIndex, endIndex + 1);
        } else {
          throw new Error('Could not extract JSON from markdown-formatted response');
        }
      }

      // Attempt to parse as JSON
      const parsed = JSON.parse(content);

      if (!parsed.endpoints || !Array.isArray(parsed.endpoints)) {
        throw new Error('Invalid response format: missing endpoints array');
      }

      return parsed.endpoints;
    } catch (jsonError) {
      console.error('Failed to parse LLM response as JSON:', jsonError);
      console.error('Raw content:', content);
      throw new Error('Failed to parse LLM response: ' + jsonError.message);
    }
  } catch (error) {
    console.error('Azure LLM API call failed:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw new Error(`LLM API call failed: ${error.message}`);
  }
}

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
        // Send status before calling LLM
        event.sender.send('generate-requests-result', {
          success: true,
          interim: true,
          message: 'Calling AI model...'
        });

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
