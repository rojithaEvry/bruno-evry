const { ipcRenderer, contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  // Expose send for one-way messages from renderer to main
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  // Expose invoke for two-way messages (request/response)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // Expose on for receiving messages from main
  on: (channel, handler) => {
    // Deliberately strip event as it includes `sender`
    const subscription = (event, ...args) => handler(...args);
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
