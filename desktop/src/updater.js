// Background updates from GitHub Releases (electron-updater). The installed app
// checks on start and every few hours, downloads quietly, and the widget offers
// "Restart to update" once the new version is ready.
const { app } = require('electron');

const CHECK_EVERY_MS = 4 * 3600 * 1000;

let autoUpdater = null;
let state = { status: 'idle', version: null, progress: null, error: null };
let notify = () => {};

function set(next) {
  state = { ...state, ...next };
  notify(state);
}

function init(onChange) {
  notify = onChange;
  if (!app.isPackaged) return set({ status: 'dev' });
  // The single-file portable exe cannot replace itself.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return set({ status: 'portable' });

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', progress: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: err?.message?.split('\n')[0] || 'Update check failed' }));

  check();
  setInterval(check, CHECK_EVERY_MS);
}

function check() {
  if (!autoUpdater || state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function install() {
  if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, install, getState: () => state };
