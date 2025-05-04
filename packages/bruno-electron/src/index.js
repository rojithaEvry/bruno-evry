const fs = require('fs');
const path = require('path');
const isDev = require('electron-is-dev');
const { format, URL } = require('url');
const { BrowserWindow, app, session, Menu, ipcMain } = require('electron');
const { setContentSecurityPolicy } = require('electron-util');

// Load environment variables AFTER built-in modules are required
try {
  const envPath = path.resolve(__dirname, '../../.env');
  console.log(`Attempting to load .env file from: ${envPath}`);
  const result = require('dotenv').config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  } else {
    console.log('.env file loaded successfully.');
    // Check if variables are loaded immediately after config
    console.log('MSAL_CLIENT_ID loaded:', process.env.MSAL_CLIENT_ID ? 'Yes' : 'No');
    console.log('MSAL_TENANT_ID loaded:', process.env.MSAL_TENANT_ID ? 'Yes' : 'No');
    console.log('MSAL_REDIRECT_URI loaded:', process.env.MSAL_REDIRECT_URI ? 'Yes' : 'No');
    console.log('MSAL_SCOPES loaded:', process.env.MSAL_SCOPES ? 'Yes' : 'No');
  }
} catch (err) {
  console.error('Critical error during dotenv configuration:', err);
}

const menuTemplate = require('./app/menu-template');
const { openCollection } = require('./app/collections');
const LastOpenedCollections = require('./store/last-opened-collections');
const registerNetworkIpc = require('./ipc/network');
const registerCollectionsIpc = require('./ipc/collection');
const registerPreferencesIpc = require('./ipc/preferences');
const Watcher = require('./app/watcher');
const { loadWindowState, saveBounds, saveMaximized } = require('./utils/window');
const registerNotificationsIpc = require('./ipc/notifications');
const registerGlobalEnvironmentsIpc = require('./ipc/global-environments');
const { safeParseJSON, safeStringifyJSON } = require('./utils/common');

// Import the new LLM IPC handler
const registerLlmIpc = require('./ipc/llm');

const lastOpenedCollections = new LastOpenedCollections();

// Reference: https://content-security-policy.com/
const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'self' https://*.posthog.com",
  "font-src 'self' https: data:;",
  'frame-src data:',
  // this has been commented out to make oauth2 work
  // "form-action 'none'",
  // we make an exception and allow http for images so that
  // they can be used as link in the embedded markdown editors
  "img-src 'self' blob: data: http: https:",
  "media-src 'self' blob: data: https:",
  "style-src 'self' 'unsafe-inline' https:"
];

setContentSecurityPolicy(contentSecurityPolicy.join(';') + ';');

const menu = Menu.buildFromTemplate(menuTemplate);

let mainWindow;
let watcher;

// Prepare the renderer once the app is ready
app.on('ready', async () => {
  if (isDev) {
    const { installExtension, REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer');
    try {
      const extensions = await installExtension([REDUX_DEVTOOLS, REACT_DEVELOPER_TOOLS], {
        loadExtensionOptions: { allowFileAccess: true }
      });
      console.log(`Added Extensions:  ${extensions.map((ext) => ext.name).join(', ')}`);
      await require('node:timers/promises').setTimeout(1000);
      session.defaultSession.getAllExtensions().map((ext) => {
        console.log(`Loading Extension: ${ext.name}`);
        session.defaultSession.loadExtension(ext.path);
      });
    } catch (err) {
      console.error('An error occurred while loading extensions: ', err);
    }
  }

  Menu.setApplicationMenu(menu);
  const { maximized, x, y, width, height } = loadWindowState();

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true
    },
    title: 'Bruno',
    icon: path.join(__dirname, 'about/256x256.png')
    // we will bring this back
    // see https://github.com/usebruno/bruno/issues/440
    // autoHideMenuBar: true
  });

  if (maximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  const url = isDev
    ? 'http://localhost:3000'
    : format({
        pathname: path.join(__dirname, '../web/index.html'),
        protocol: 'file:',
        slashes: true
      });

  mainWindow.loadURL(url).catch((reason) => {
    console.error(`Error: Failed to load URL: "${url}" (Electron shows a blank screen because of this).`);
    console.error('Original message:', reason);
    if (isDev) {
      console.error(
        'Could not connect to Next.Js dev server, is it running?' +
          ' Start the dev server using "npm run dev:web" and restart electron'
      );
    } else {
      console.error(
        'If you are using an official production build: the above error is most likely a bug! ' +
          ' Please report this under: https://github.com/usebruno/bruno/issues'
      );
    }
  });
  watcher = new Watcher();

  const handleBoundsChange = () => {
    if (!mainWindow.isMaximized()) {
      saveBounds(mainWindow);
    }
  };

  mainWindow.on('resize', handleBoundsChange);
  mainWindow.on('move', handleBoundsChange);

  mainWindow.on('maximize', () => saveMaximized(true));
  mainWindow.on('unmaximize', () => saveMaximized(false));
  mainWindow.on('close', (e) => {
    e.preventDefault();
    ipcMain.emit('main:start-quit-flow');
  });

  mainWindow.webContents.on('will-redirect', (event, url) => {
    event.preventDefault();
    if (/^(http:\/\/|https:\/\/)/.test(url)) {
      require('electron').shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (['https:', 'http:'].includes(protocol)) {
        require('electron').shell.openExternal(url);
      }
    } catch (e) {
      console.error(e);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    let ogSend = mainWindow.webContents.send;
    mainWindow.webContents.send = function (channel, ...args) {
      // Modify mapping: Only stringify/parse non-primitive types (like objects/arrays)
      const mappedArgs = args?.map((arg) => {
        if (typeof arg === 'object' && arg !== null) {
          // Apply stringify/parse only to objects/arrays
          return safeParseJSON(safeStringifyJSON(arg));
        } else {
          // Pass primitives (string, number, boolean, null, undefined) directly
          return arg;
        }
      });
      // Apply the original send with potentially modified arguments
      return ogSend.apply(this, [channel, ...mappedArgs]);
    };
  });

  // register all ipc handlers
  registerNetworkIpc(mainWindow);
  registerGlobalEnvironmentsIpc(mainWindow);
  registerCollectionsIpc(mainWindow, watcher, lastOpenedCollections);
  registerPreferencesIpc(mainWindow, watcher, lastOpenedCollections);
  registerNotificationsIpc(mainWindow, watcher);

  // Register the LLM IPC handler
  registerLlmIpc(mainWindow);

  // Add MS Auth IPC Handler (Moved inside app.on('ready'))
  // Reads config from process.env now, removed config param from handler
  ipcMain.on('open-ms-auth', async (event) => {
    console.log('Main process received open-ms-auth request');

    // Read config from environment variables
    const clientId = process.env.MSAL_CLIENT_ID;
    const tenantId = process.env.MSAL_TENANT_ID;
    const redirectUri = process.env.MSAL_REDIRECT_URI;
    const scopesString = process.env.MSAL_SCOPES || ''; // Default to empty string if not set
    const scopes = scopesString.split(' ').filter((s) => s); // Split by space and remove empty strings
    const authority = `https://login.microsoftonline.com/${tenantId}`; // Construct authority URL

    // Basic validation
    if (!clientId || !tenantId || !redirectUri || scopes.length === 0) {
      const errorMsg =
        'MSAL configuration missing in .env file (MSAL_CLIENT_ID, MSAL_TENANT_ID, MSAL_REDIRECT_URI, MSAL_SCOPES)';
      console.error(errorMsg);
      event.sender.send('ms-auth-error', errorMsg);
      return;
    }

    // Create a unique session partition for this auth window
    const authPartition = `persist:msauth_${Date.now()}`;
    const authSession = session.fromPartition(authPartition);

    // Define a more permissive CSP for the MS Auth flow
    const msAuthCsp = [
      "default-src 'self' https://login.microsoftonline.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.microsoftonline.com",
      "style-src 'self' 'unsafe-inline' https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.microsoftonline.com",
      "img-src 'self' data: https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.microsoftonline.com",
      "font-src 'self' https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.microsoftonline.com",
      "connect-src 'self' https://login.microsoftonline.com",
      "frame-src 'self' https://login.microsoftonline.com"
    ].join('; ');

    // Intercept headers to apply the custom CSP for the auth session
    authSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders || {};
      responseHeaders['content-security-policy'] = [msAuthCsp];
      callback({ cancel: false, responseHeaders });
    });

    const authUrl = new URL(`${authority}/oauth2/v2.0/authorize`);
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', scopes.join(' '));

    let authWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      parent: mainWindow,
      modal: true,
      webPreferences: {
        partition: authPartition,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    authWindow.once('ready-to-show', () => {
      authWindow.show();
    });

    authWindow.on('closed', () => {
      authSession.webRequest.onHeadersReceived(null);
      authWindow = null;
    });

    const handleNavigation = (navigationUrl) => {
      console.log('Auth window navigating to:', navigationUrl);
      try {
        const urlParts = new URL(navigationUrl);
        // Compare origins and pathnames for robust redirect URI check
        const redirectUriParts = new URL(redirectUri);
        if (urlParts.origin === redirectUriParts.origin && urlParts.pathname === redirectUriParts.pathname) {
          console.log('Redirect URI detected.');
          const hashParams = new URLSearchParams(urlParts.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const error = hashParams.get('error');
          const errorDescription = hashParams.get('error_description');

          if (accessToken) {
            console.log('Access Token extracted:', accessToken);
            console.log(
              `Attempting to send ms-auth-token with payload type: ${typeof accessToken}, length: ${
                accessToken?.length
              }`
            );
            try {
              event.sender.send('ms-auth-token', accessToken);
              console.log('Successfully called event.sender.send for ms-auth-token');
            } catch (sendError) {
              console.error('Error calling event.sender.send for ms-auth-token:', sendError);
              try {
                event.sender.send('ms-auth-error', `Failed to send token via IPC: ${sendError.message}`);
              } catch (e) {}
            }
          } else if (error) {
            console.error('MS Auth Error in redirect:', error, errorDescription);
            event.sender.send('ms-auth-error', `${error}: ${errorDescription || 'No description'}`);
          } else {
            console.error('Redirect URI matched, but no token or error found in fragment.');
            event.sender.send('ms-auth-error', 'Token or error not found in redirect fragment.');
          }

          if (authWindow && !authWindow.isDestroyed()) {
            authWindow.close();
          }
        }
      } catch (e) {
        console.error('Error processing navigation URL:', e);
        if (authWindow && !authWindow.isDestroyed()) {
          // authWindow.close();
        }
      }
    };

    authWindow.webContents.on('will-navigate', (e, navigationUrl) => {
      handleNavigation(navigationUrl);
    });
    authWindow.webContents.on('did-navigate', (e, navigationUrl) => {
      handleNavigation(navigationUrl);
    });
    authWindow.webContents.on('did-fail-load', (evt, errorCode, errorDescription, validatedURL) => {
      console.error(`Auth window failed to load: ${errorDescription} (Code: ${errorCode}) URL: ${validatedURL}`);
      if (!authWindow?.isDestroyed()) {
        event.sender.send('ms-auth-error', `Auth window failed to load: ${errorDescription}`);
        if (authWindow) authWindow.close();
      }
    });

    try {
      console.log('Loading auth URL:', authUrl.toString());
      await authWindow.loadURL(authUrl.toString());
    } catch (error) {
      console.error('Failed to load auth URL:', error);
      event.sender.send('ms-auth-error', `Failed to load MS Auth page: ${error.message}`);
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
    }
  });
}); // Correct placement for end of app.on('ready', ...)

// Quit the app once all windows are closed
app.on('window-all-closed', app.quit);

// Open collection from Recent menu (#1521)
app.on('open-file', (event, path) => {
  openCollection(mainWindow, watcher, path);
});
