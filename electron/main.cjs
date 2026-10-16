const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');

const isMac = process.platform === 'darwin';
let mainWindow;

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

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
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

app.whenReady().then(() => {
  if (!isMac) {
    dialog.showErrorBox('MacBook app only', 'Jarvis AI is packaged for macOS and can only run on a MacBook or other Mac.');
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Microphone access is requested only by the visible voice-input action.
    // Every other browser permission is denied by default.
    callback(permission === 'media');
  });

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
