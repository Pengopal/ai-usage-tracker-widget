const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  setView: (view) => ipcRenderer.send('set-view', view),
  syncNow: () => ipcRenderer.send('sync-now'),
  signIn: (name) => ipcRenderer.send('sign-in', name),
  signOut: (name) => ipcRenderer.invoke('sign-out', name),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  windowAction: (action) => ipcRenderer.send('window', action),
  fit: (mode, height) => ipcRenderer.send('fit', { mode, height }),
  openUrl: (name) => ipcRenderer.send('open-url', name),
  checkUpdate: () => ipcRenderer.send('update-check'),
  installUpdate: () => ipcRenderer.send('update-install'),
  openReleases: () => ipcRenderer.send('open-releases'),
  onData: (cb) => ipcRenderer.on('data-updated', (_e, data) => cb(data)),
});
