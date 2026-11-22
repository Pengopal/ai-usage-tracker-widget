const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  saveProvider: (id, patch) => ipcRenderer.invoke('save-provider', id, patch),
  saveOrder: (ids) => ipcRenderer.invoke('save-order', ids),
  setView: (view) => ipcRenderer.send('set-view', view),
  syncNow: () => ipcRenderer.send('sync-now'),
  signIn: (id) => ipcRenderer.send('sign-in', id),
  signOut: (id) => ipcRenderer.invoke('sign-out', id),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  windowAction: (action) => ipcRenderer.send('window', action),
  fit: (mode, height, width) => ipcRenderer.send('fit', { mode, height, width }),
  openUrl: (id) => ipcRenderer.send('open-url', id),
  checkUpdate: () => ipcRenderer.send('update-check'),
  installUpdate: () => ipcRenderer.send('update-install'),
  openReleases: () => ipcRenderer.send('open-releases'),
  onData: (cb) => ipcRenderer.on('data-updated', (_e, data) => cb(data)),
});
