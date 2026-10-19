const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const { startJarvisServer } = require('../backend/src/server.cjs');

const isMac = process.platform === 'darwin';
let mainWindow;
let localServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    title: 'Jarvis AI',
    backgroundColor: '#080a11',
    show: false,
    titleBarStyle: 'hiddenInset',
    // Place native traffic lights in the top bar, clear of the Jarvis brand in the sidebar.
    trafficLightPosition: { x: 261, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(localServer.url);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Jarvis AI',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'Command+,',
          click: () => mainWindow?.webContents.send('jarvis:open-settings')
        },
        {
          label: 'Open JARVIS Data Folder',
          click: () => shell.openPath(app.getPath('userData'))
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Command',
      submenu: [
        {
          label: 'Invoke Jarvis',
          accelerator: 'Command+J',
          click: () => mainWindow?.webContents.send('jarvis:focus-command')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (!isMac) {
    dialog.showErrorBox('MacBook app only', 'Jarvis AI is packaged for macOS and can only run on a MacBook or other Mac.');
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Media permission is requested only from the visible voice or future webcam flows.
    // All other browser permissions are denied by default.
    callback(permission === 'media');
  });

  try {
    // The API is loopback-only and is started by the native app; it is never exposed to the LAN.
    localServer = await startJarvisServer({
      port: 0,
      host: '127.0.0.1',
      // A user-managed .env in Application Support can configure the model without
      // embedding credentials in the app bundle or website source.
      envFile: path.join(app.getPath('userData'), '.env')
    });
    buildMenu();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('JARVIS could not start', `The protected local service failed to start.\n\n${error.message}`);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && localServer) createWindow();
  });
});

app.on('before-quit', () => {
  localServer?.server.close();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

ipcMain.handle('jarvis:desktop-info', () => ({
  platform: 'macOS',
  isMac: true,
  appVersion: app.getVersion(),
  release: process.getSystemVersion()
}));
