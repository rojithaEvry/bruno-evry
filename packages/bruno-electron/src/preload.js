const { ipcRenderer, contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  // Expose send for one-way messages from renderer to main
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  // Expose invoke for two-way messages (request/response)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // Expose on for receiving messages from main
  on: (channel, handler) => {
    // The original handler expects (event, ...payloadArgs)
    // We need to pass all payloadArgs to the renderer's handler
    const subscription = (event, ...payloadArgs) => handler(...payloadArgs);
    ipcRenderer.on(channel, subscription);

    // Return a cleanup function conforming to the expected pattern
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  // Keep custom getFilePath if needed
  getFilePath(file) {
    const path = webUtils.getPathForFile(file);
    return path;
  }
});
