const { ipcRenderer, contextBridge, webUtils } = require('electron');

// Special list of channels that should receive the event object
const eventObjectChannels = ['evry-auth-token', 'evry-auth-error', 'ms-auth-token', 'ms-auth-error'];

// Strict token channels that should ensure token is passed correctly
const tokenChannels = ['evry-auth-token', 'ms-auth-token'];

contextBridge.exposeInMainWorld('ipcRenderer', {
  // Expose send for one-way messages from renderer to main
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),

  // Expose invoke for two-way messages (request/response)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // Expose on for receiving messages from main
  on: (channel, handler) => {
    console.log(`Registering handler for IPC channel: ${channel}`);

    // For authentication channels, we'll pass both event and payload
    if (eventObjectChannels.includes(channel)) {
      console.log(`Special handling for auth channel: ${channel}`);

      const subscription = (event, ...payloadArgs) => {
        // For token channels, ensure the token is properly passed
        if (tokenChannels.includes(channel)) {
          console.log(`IPC ${channel} received in preload with args:`, payloadArgs);

          // Get the token from payload args
          const token = payloadArgs[0];

          if (token && typeof token === 'string' && token.length > 0) {
            console.log(`Valid token received in preload for ${channel}, length:`, token.length);
            console.log('First 20 chars of token:', token.substring(0, 20) + '...');
            return handler(event, token);
          } else {
            console.error(`Invalid token received in preload for ${channel}:`, token);
            return handler(event, null);
          }
        }
        // For error channels, pass through as is
        else {
          console.log(`IPC ${channel} received in preload:`, ...payloadArgs);
          return handler(event, ...payloadArgs);
        }
      };

      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    } else {
      // For other channels, use the original pattern
      const subscription = (event, ...payloadArgs) => handler(...payloadArgs);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
  },

  // Keep custom getFilePath if needed
  getFilePath(file) {
    const path = webUtils.getPathForFile(file);
    return path;
  }
});
