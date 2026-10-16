const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisDesktop', {
  getInfo: () => ipcRenderer.invoke('jarvis:desktop-info'),
  onFocusCommand: (callback) => ipcRenderer.on('jarvis:focus-command', callback),
  onOpenSettings: (callback) => ipcRenderer.on('jarvis:open-settings', callback)
});
