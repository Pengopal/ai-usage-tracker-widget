const {
  app, BrowserWindow, ipcMain, Tray, Menu, shell, Notification, screen,
} = require('electron');
const path = require('path');
const { mkdirSync } = require('fs');
const { Store, cleanThresholds } = require('./store');
const { services } = require('./sync');
const { ChatGPT, bundledCodex } = require('./chatgpt');
const updater = require('./updater');
const { computeInsights, sampleOf } = require('./core/insights');
const { CATALOG, emptyService, planOptions, orderedIds, buildRows } = require('./core/providers');

const DEFAULT_WIDTH = { bars: 320, rings: 264 };
const DEFAULT_HEIGHT = 200;
const SYNC_MS = 60 * 1000;
const PACE_ALERT_MS = 30 * 60 * 1000;
const BACK_FROM_PCT = 90;
const BACK_BELOW_PCT = 50;
const APP_NAME = 'Pengopal AI Usage Tracker';
const appIcon = path.join(__dirname, 'assets', 'app-icon.png');
const trayIcon = path.join(__dirname, 'assets', 'app-icon.ico');

let win = null;
let tray = null;
let store = null;
let quitting = false;
let syncing = false;
let mode = 'widget'; // or 'settings'
let chatgpt;
let chatgptLogin = null;
let chatgptBusy = false;
let chatgptError = null;
let chatgptRevision = 0;

// Reuse the existing profile after renaming the Windows product.
const customProfile = app.commandLine.getSwitchValue('user-data-dir');
const userData = customProfile ? path.resolve(customProfile) : path.join(app.getPath('appData'), 'AI Usage Tracker Widget');
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const view = () => store.data.settings.view;
const savedWidth = (v = view()) => store.data.bounds?.widths?.[v] || DEFAULT_WIDTH[v];
const order = () => orderedIds(store.data.settings.order);
const enabledIds = () => order().filter((id) => store.data.settings.providers[id]?.enabled !== false);

function initialBounds() {
  const saved = store.data.bounds;
  const width = savedWidth();
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      saved.x >= a.x - 50 && saved.y >= a.y - 50 &&
      saved.x < a.x + a.width - 50 && saved.y < a.y + a.height - 50);
    if (visible) return { x: saved.x, y: saved.y, width, height: DEFAULT_HEIGHT };
  }
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width,
    height: DEFAULT_HEIGHT,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
  };
}

function createWindow() {
  win = new BrowserWindow({
    ...initialBounds(),
    minWidth: 220,
    minHeight: 60,
    frame: false,
    backgroundColor: '#0e1a3a',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: store.data.settings.alwaysOnTop,
    show: false,
    icon: appIcon,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (store.data.settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Position and the width of the current view are remembered; height follows content.
  let saveTimer = null;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const b = win.getBounds();
      const widths = { ...(store.data.bounds?.widths || {}) };
      if (mode === 'widget' && view() === 'bars') widths.bars = b.width;
      store.set({ bounds: { x: b.x, y: b.y, widths } });
    }, 400);
  };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);

  win.on('close', (e) => {
    if (!quitting && store.data.settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
    } else if (!quitting) {
      quitting = true;
      app.quit();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function saveSettings(patch) {
  store.set({ settings: { ...store.data.settings, ...patch } });
  win.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'floating');
  refreshTrayMenu();
  pushData();
}

function setView(next) {
  if (next === view()) return;
  saveSettings({ view: next });
}

function refreshTrayMenu() {
  if (!tray) return;
  const up = updater.getState();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show widget', click: showWindow },
    { label: 'Sync now', click: () => syncAll() },
    {
      label: 'Compact ring view',
      type: 'checkbox',
      checked: view() === 'rings',
      click: (item) => setView(item.checked ? 'rings' : 'bars'),
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: store.data.settings.alwaysOnTop,
      click: (item) => saveSettings({ alwaysOnTop: item.checked }),
    },
    { type: 'separator' },
    ...(up.status === 'ready'
      ? [{ label: `Restart to update (v${up.version})`, click: installUpdate }, { type: 'separator' }]
      : []),
    ...enabledIds().map((id) => ({ label: `Open ${CATALOG[id].name}`, click: () => shell.openExternal(CATALOG[id].url) })),
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  refreshTrayMenu();
}

function snapshot() {
  const { services: data, settings } = store.data;
  const insights = computeInsights(data, store.history);
  return {
    settings,
    syncing,
    rows: buildRows(data, settings.providers, insights, settings.order),
    chatgpt: { signingIn: !!chatgptLogin, busy: chatgptBusy, error: chatgptError },
    providers: order().map((id) => ({
      id,
      name: CATALOG[id].name,
      logo: CATALOG[id].logo,
      enabled: settings.providers[id].enabled,
      plan: settings.providers[id].plan,
      plans: planOptions(id),
      connected: data[id].connected,
      lastSync: data[id].lastSync,
      error: data[id].error,
    })),
    update: updater.getState(),
    version: app.getVersion(),
  };
}

function pushData() {
  if (win && !win.isDestroyed()) win.webContents.send('data-updated', snapshot());
}

// Folds one service's sync result into what is stored. Network errors keep the
// last good numbers on screen and only set the error text.
function merge(id, result) {
  const prev = store.data.services[id];
  if (result.status === 'rejected') return { ...prev, error: result.reason?.message || 'Sync failed' };
  const { raw, ...value } = result.value;
  store.writeDebug(id, raw);
  if (!value.connected) return emptyService();
  if (value.error) return { ...prev, connected: true, error: value.error };
  return {
    connected: true,
    windows: value.windows || {},
    plan: value.plan ?? prev.plan ?? null,
    detail: value.detail || null,
    error: null,
    lastSync: new Date().toISOString(),
  };
}

const readService = (id) => id === 'openai' ? chatgpt.read()
  : services[id].read({ grokModel: store.data.settings.grokModel });

async function syncAll() {
  if (syncing) return;
  syncing = true;
  pushData();
  try {
    const revision = chatgptRevision;
    const ids = enabledIds().filter((id) => id !== 'openai' || (!chatgptLogin && !chatgptBusy));
    const results = await Promise.allSettled(ids.map(readService));
    const next = { ...store.data.services };
    ids.forEach((id, i) => {
      if (id !== 'openai' || revision === chatgptRevision) next[id] = merge(id, results[i]);
    });
    store.set({ services: next });
    store.addSample(sampleOf(store.data.services));
  } finally {
    syncing = false;
    checkAlerts();
    pushData();
  }
}

function notifyUser(title, body) {
  new Notification({ title, body, icon: appIcon }).show();
}

const windowKey = (id, reset) => `${id}@${reset ? reset.slice(0, 13) : 'rolling'}`;

// Threshold alerts once per threshold per reset window; a pace heads-up when the
// current burn rate runs out within 30 minutes; and a note when a limit is back.
// Only limits the widget shows (enabled provider, chosen plan) raise alerts.
function checkAlerts() {
  const d = store.data;
  const s = d.settings;
  const can = s.notifications && Notification.isSupported();
  const thresholds = [...s.thresholds].sort((a, b) => b - a);
  const lowest = thresholds[thresholds.length - 1] ?? 75;
  const insights = computeInsights(d.services, store.history);
  const notified = {};
  const lastPct = { ...d.lastPct };

  for (const row of buildRows(d.services, s.providers, insights, s.order)) {
    for (const m of row.metrics) {
      const label = `${row.name} ${m.label.toLowerCase()} limit`;
      const key = windowKey(m.id, m.reset);

      // A drop back under the lowest threshold starts a fresh cycle for rolling windows.
      let prev = d.notified[key] || 0;
      if (m.pct < lowest) prev = 0;
      notified[key] = prev;
      const hit = thresholds.find((t) => m.pct >= t);
      if (hit && hit > prev) {
        notified[key] = hit;
        if (can) {
          notifyUser(
            `${label} at ${m.pct}%`,
            hit >= 100 ? 'Limit reached.' : hit >= 90 ? 'You are nearly out of usage.' : `You have used over ${hit}% of this limit.`,
          );
        }
      }

      const paceKey = `pace:${key}`;
      if (d.notified[paceKey]) notified[paceKey] = true;
      if (s.paceAlerts && m.pace != null && m.pace <= PACE_ALERT_MS && !d.notified[paceKey]) {
        notified[paceKey] = true;
        if (can) notifyUser(`${label}: heads-up`, `At your current pace you'll hit it in about ${Math.max(1, Math.round(m.pace / 60000))} minutes.`);
      }

      if (s.backAlerts && can && lastPct[m.id] >= BACK_FROM_PCT && m.pct < BACK_BELOW_PCT) {
        notifyUser(`${label} is back`, `Usage reset to ${m.pct}%. You're good to go.`);
      }
      lastPct[m.id] = m.pct;
    }
  }

  if (JSON.stringify(notified) !== JSON.stringify(d.notified) || JSON.stringify(lastPct) !== JSON.stringify(d.lastPct)) {
    store.set({ notified, lastPct });
  }
}

function installUpdate() {
  quitting = true;
  updater.install();
}

async function signInChatGPT() {
  if (chatgptLogin || chatgptBusy) return;
  const attempt = new AbortController();
  chatgptLogin = attempt;
  chatgptError = null;
  pushData();
  try {
    if (!await chatgpt.signIn(attempt.signal)) return;
    chatgptLogin = null;
    chatgptBusy = true;
    chatgptRevision++;
    showWindow();
    pushData();
    const [result] = await Promise.allSettled([readService('openai')]);
    store.setService('openai', merge('openai', result));
    store.addSample(sampleOf(store.data.services));
    checkAlerts();
  } catch (error) {
    if (!attempt.signal.aborted) {
      chatgptError = error.message;
      showWindow();
    }
  } finally {
    chatgptLogin = null;
    chatgptBusy = false;
    pushData();
  }
}

function registerIpc() {
  ipcMain.handle('get-data', () => snapshot());

  ipcMain.handle('save-settings', (_e, patch) => {
    const before = store.data.settings;
    const next = { ...patch };
    if ('thresholds' in next) next.thresholds = cleanThresholds(next.thresholds);
    saveSettings(next);
    if (next.grokModel !== undefined && next.grokModel !== before.grokModel) syncAll();
    return snapshot();
  });

  // Show/hide a provider or pick its plan.
  ipcMain.handle('save-provider', (_e, id, patch) => {
    if (!CATALOG[id]) return snapshot();
    const wasEnabled = store.data.settings.providers[id].enabled;
    const providers = { ...store.data.settings.providers, [id]: { ...store.data.settings.providers[id], ...patch } };
    saveSettings({ providers });
    if (!wasEnabled && providers[id].enabled) syncAll();
    return snapshot();
  });

  // New provider order from drag-and-drop in settings.
  ipcMain.handle('save-order', (_e, ids) => {
    saveSettings({ order: orderedIds(ids) });
    return snapshot();
  });

  ipcMain.on('set-view', (_e, next) => setView(next === 'rings' ? 'rings' : 'bars'));

  ipcMain.on('sync-now', () => syncAll());

  ipcMain.on('sign-in', (_e, id) => {
    if (id === 'openai') return signInChatGPT();
    const svc = services[id];
    if (!svc) return;
    svc.openLogin(async () => (await readService(id)).connected, async () => {
      await syncAll();
      showWindow();
    });
  });

  ipcMain.on('cancel-chatgpt-sign-in', () => chatgptLogin?.abort());

  ipcMain.handle('sign-out', async (_e, id) => {
    const svc = services[id];
    if (!svc) return snapshot();
    if (id === 'openai') {
      if (chatgptLogin || chatgptBusy) return snapshot();
      chatgptBusy = true;
      chatgptError = null;
      chatgptRevision++;
      pushData();
      try {
        await chatgpt.signOut();
      } catch {
        chatgptError = 'Could not sign out of ChatGPT. Try again.';
      } finally {
        chatgptBusy = false;
      }
      if (chatgptError) {
        pushData();
        return snapshot();
      }
    } else {
      await svc.signOut();
    }
    store.setService(id, emptyService());
    pushData();
    return snapshot();
  });

  ipcMain.handle('toggle-always-on-top', () => {
    saveSettings({ alwaysOnTop: !store.data.settings.alwaysOnTop });
    return store.data.settings.alwaysOnTop;
  });

  ipcMain.on('window', (_e, action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'tray') win.hide();
    if (action === 'close') win.close();
  });

  // The renderer reports the size its content needs; the window follows, staying
  // on screen and anchored at its right edge. Ring view also sets the width.
  let lastLayout = null; // 'settings' | 'rings' | 'bars'
  ipcMain.on('fit', (_e, next) => {
    mode = next.mode === 'settings' ? 'settings' : 'widget';
    const layout = mode === 'settings' ? 'settings' : next.width ? 'rings' : 'bars';
    const b = win.getBounds();
    const { workArea } = screen.getDisplayMatching(b);
    const height = Math.max(60, Math.min(Math.ceil(next.height), workArea.height));
    // Bars keep whatever width the user dragged them to, restored after the
    // other layouts borrowed the window.
    let width = b.width;
    if (layout === 'settings') width = Math.max(b.width, 340);
    else if (layout === 'rings') width = Math.ceil(next.width);
    else if (lastLayout && lastLayout !== 'bars') width = savedWidth('bars');
    lastLayout = layout;
    const x = Math.max(workArea.x, b.x + b.width - width);
    const y = Math.max(workArea.y, Math.min(b.y, workArea.y + workArea.height - height));
    if (b.height !== height || b.width !== width || b.x !== x || b.y !== y) {
      win.setBounds({ x, y, width, height });
    }
  });

  ipcMain.on('open-url', (_e, id) => {
    if (CATALOG[id]) shell.openExternal(CATALOG[id].url);
  });

  ipcMain.on('update-check', () => updater.check());
  ipcMain.on('update-install', installUpdate);
  ipcMain.on('open-releases', () => shell.openExternal('https://github.com/Pengopal/ai-usage-tracker-widget/releases'));
}

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  app.setAppUserModelId('com.mufurqan.aiusagetracker');
  store = new Store(app.getPath('userData'));
  chatgpt = new ChatGPT({
    binary: bundledCodex(app.isPackaged),
    home: path.join(app.getPath('userData'), 'chatgpt-codex'),
    openBrowser: (url) => shell.openExternal(url),
    legacy: services.openai,
  });
  registerIpc();
  createWindow();
  createTray();
  updater.init(() => {
    refreshTrayMenu();
    pushData();
  });
  syncAll();
  setInterval(syncAll, SYNC_MS);
});

app.on('before-quit', () => {
  quitting = true;
  chatgptLogin?.abort();
  chatgpt?.close();
});
// Hidden sync windows count as windows; quitting is driven by the tray / close button.
app.on('window-all-closed', () => {});
