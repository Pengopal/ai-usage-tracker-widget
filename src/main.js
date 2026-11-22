const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, Notification, screen,
} = require('electron');
const path = require('path');
const { Store, normalize, cleanThresholds } = require('./store');
const sync = require('./sync');
const updater = require('./updater');
const { METRICS, computeInsights, sampleOf } = require('./insights');

const DEFAULT_WIDTH = { bars: 340, rings: 264 };
const DEFAULT_HEIGHT = 200;
const SYNC_MS = 60 * 1000;
const PACE_ALERT_MS = 30 * 60 * 1000;
const BACK_FROM_PCT = 90;
const BACK_BELOW_PCT = 50;
const SERVICES = { claude: sync.claude, grok: sync.grok };
const LABELS = {
  'claude.session': 'Claude 5-hour session',
  'claude.weekly': 'Claude weekly limit',
  grok: 'Grok usage',
};

let win = null;
let tray = null;
let store = null;
let quitting = false;
let syncing = false;
let mode = 'widget'; // or 'settings'

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Draws a small round gauge icon in memory so the app ships without image assets.
function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const rOuter = size / 2;
  const rInner = size * 0.28;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4; // BGRA
      if (d > rOuter) continue;
      const angle = Math.atan2(y - c, x - c);
      const ring = d > rInner;
      // Blue ring with an orange arc in the upper-right quadrant.
      const hot = ring && angle < -Math.PI * 0.15 && angle > -Math.PI * 0.75;
      const [r, g, b] = !ring ? [15, 15, 19] : hot ? [255, 159, 67] : [77, 166, 255];
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const view = () => store.data.settings.view;
const savedWidth = (v = view()) => store.data.bounds?.widths?.[v] || DEFAULT_WIDTH[v];

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
    minWidth: 240,
    minHeight: 80,
    frame: false,
    backgroundColor: '#0e0e12',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: store.data.settings.alwaysOnTop,
    show: false,
    icon: makeIcon(32),
    title: 'AI Usage Tracker',
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
      if (mode === 'widget') widths[view()] = b.width;
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

function setAlwaysOnTop(on) {
  store.set({ settings: { ...store.data.settings, alwaysOnTop: on } });
  win.setAlwaysOnTop(on, 'floating');
  refreshTrayMenu();
  pushData();
}

function setView(next) {
  if (next === view()) return;
  store.set({ settings: { ...store.data.settings, view: next } });
  const b = win.getBounds();
  const width = savedWidth(next);
  // Keep the right edge anchored: the widget usually lives at the screen's right side.
  win.setBounds({ ...b, x: b.x + b.width - width, width });
  refreshTrayMenu();
  pushData();
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
      click: (item) => setAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    ...(up.status === 'ready'
      ? [{ label: `Restart to update (v${up.version})`, click: installUpdate }, { type: 'separator' }]
      : []),
    { label: 'Open claude.ai usage', click: () => shell.openExternal(sync.claude.browserUrl) },
    { label: 'Open grok.com', click: () => shell.openExternal(sync.grok.browserUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(makeIcon(16));
  tray.setToolTip('AI Usage Tracker');
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  refreshTrayMenu();
}

function snapshot() {
  return {
    ...store.data,
    syncing,
    insights: computeInsights(store.data, store.history),
    update: updater.getState(),
    version: app.getVersion(),
  };
}

function pushData() {
  if (win && !win.isDestroyed()) win.webContents.send('data-updated', snapshot());
}

// Folds one service's sync result into what is stored. Network errors keep the
// last good numbers on screen and only set the error text.
function merge(name, result) {
  const prev = store.data[name];
  if (result.status === 'rejected') return { ...prev, error: result.reason?.message || 'Sync failed' };
  const { raw, ...value } = result.value;
  store.writeDebug(name, raw);
  if (!value.connected) return { ...normalize({})[name], connected: false };
  if (value.error) return { ...prev, connected: true, error: value.error };
  return { ...prev, ...value, error: null, lastSync: new Date().toISOString() };
}

async function syncAll() {
  if (syncing) return;
  syncing = true;
  pushData();
  try {
    const [c, g] = await Promise.allSettled([
      sync.syncClaude(),
      sync.syncGrok(store.data.settings.grokModel),
    ]);
    store.set({ claude: merge('claude', c), grok: merge('grok', g) });
    store.addSample(sampleOf(store.data));
  } finally {
    syncing = false;
    checkAlerts();
    pushData();
  }
}

function notifyUser(title, body) {
  new Notification({ title, body, icon: makeIcon(64), silent: false }).show();
}

const windowKey = (id, reset) => `${id}@${reset ? reset.slice(0, 13) : 'rolling'}`;

// Threshold alerts once per threshold per reset window; a pace heads-up when the
// current burn rate runs out within 30 minutes; and a note when a limit is back.
function checkAlerts() {
  const d = store.data;
  const s = d.settings;
  const can = s.notifications && Notification.isSupported();
  const insights = computeInsights(d, store.history);
  const thresholds = [...s.thresholds].sort((a, b) => b - a);
  const notified = {};
  const lastPct = { ...d.lastPct };

  for (const [id, m] of Object.entries(METRICS)) {
    const cur = m.read(d);
    if (!cur || cur.pct == null) continue;
    const { pct, reset } = cur;
    const key = windowKey(id, reset);

    // A drop back under the lowest threshold starts a fresh cycle for rolling windows.
    let prev = d.notified[key] || 0;
    if (pct < (thresholds[thresholds.length - 1] ?? 75)) prev = 0;
    notified[key] = prev;
    const hit = thresholds.find((t) => pct >= t);
    if (hit && hit > prev) {
      notified[key] = hit;
      if (can) {
        notifyUser(
          `${LABELS[id]} at ${pct}%`,
          hit >= 100 ? 'Limit reached.' : hit >= 90 ? 'You are nearly out of usage.' : `You have used over ${hit}% of this limit.`,
        );
      }
    }

    const paceKey = `pace:${key}`;
    const eta = insights.pace[id];
    if (d.notified[paceKey]) notified[paceKey] = true;
    if (s.paceAlerts && eta != null && eta <= PACE_ALERT_MS && !d.notified[paceKey]) {
      notified[paceKey] = true;
      if (can) notifyUser(`${LABELS[id]}: heads-up`, `At your current pace you'll hit the limit in about ${Math.max(1, Math.round(eta / 60000))} minutes.`);
    }

    if (s.backAlerts && can && lastPct[id] >= BACK_FROM_PCT && pct < BACK_BELOW_PCT) {
      notifyUser(`${LABELS[id]} is back`, `Usage reset to ${pct}%. You're good to go.`);
    }
    lastPct[id] = pct;
  }

  if (JSON.stringify(notified) !== JSON.stringify(d.notified) || JSON.stringify(lastPct) !== JSON.stringify(d.lastPct)) {
    store.set({ notified, lastPct });
  }
}

function installUpdate() {
  quitting = true;
  updater.install();
}

function registerIpc() {
  ipcMain.handle('get-data', () => snapshot());

  ipcMain.handle('save-settings', (_e, patch) => {
    const before = store.data.settings;
    const settings = { ...before, ...patch };
    if ('thresholds' in patch) settings.thresholds = cleanThresholds(patch.thresholds);
    store.set({ settings });
    win.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'floating');
    refreshTrayMenu();
    if (patch.grokModel !== undefined && patch.grokModel !== before.grokModel) syncAll();
    return snapshot();
  });

  ipcMain.on('set-view', (_e, next) => setView(next === 'rings' ? 'rings' : 'bars'));

  ipcMain.on('sync-now', () => syncAll());

  // Opens the real sign-in page in its own window. Once the session can read
  // usage, that window closes and the widget comes back to the front, synced.
  ipcMain.on('sign-in', (_e, name) => {
    const svc = SERVICES[name];
    if (!svc) return;
    const probe = name === 'claude'
      ? async () => (await sync.syncClaude()).connected
      : async () => (await sync.syncGrok(store.data.settings.grokModel)).connected;
    svc.openLogin(probe, async () => {
      await syncAll();
      showWindow();
    });
  });

  ipcMain.handle('sign-out', async (_e, name) => {
    const svc = SERVICES[name];
    if (!svc) return snapshot();
    await svc.signOut();
    store.set({ [name]: normalize({})[name] });
    pushData();
    return snapshot();
  });

  ipcMain.handle('toggle-always-on-top', () => {
    setAlwaysOnTop(!store.data.settings.alwaysOnTop);
    return store.data.settings.alwaysOnTop;
  });

  ipcMain.on('window', (_e, action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'tray') win.hide();
    if (action === 'close') win.close();
  });

  // The renderer reports its content height; the window grows or shrinks to fit,
  // staying on screen. Settings may ask for more room than the widget.
  ipcMain.on('fit', (_e, next) => {
    const leavingSettings = mode === 'settings' && next.mode !== 'settings';
    mode = next.mode === 'settings' ? 'settings' : 'widget';
    const b = win.getBounds();
    const { workArea } = screen.getDisplayMatching(b);
    const height = Math.max(80, Math.min(Math.ceil(next.height), workArea.height));
    // Widget width is whatever the user dragged it to; settings borrows extra room.
    const width = mode === 'settings' ? Math.max(b.width, 340) : leavingSettings ? savedWidth() : b.width;
    const x = b.x + b.width - width;
    const y = Math.min(b.y, workArea.y + workArea.height - height);
    if (b.height !== height || b.width !== width || b.x !== x || b.y !== y) {
      win.setBounds({ x: Math.max(workArea.x, x), y: Math.max(workArea.y, y), width, height });
    }
  });

  ipcMain.on('open-url', (_e, name) => {
    const svc = SERVICES[name];
    if (svc) shell.openExternal(svc.browserUrl);
  });

  ipcMain.on('update-check', () => updater.check());
  ipcMain.on('update-install', installUpdate);
  ipcMain.on('open-releases', () => shell.openExternal('https://github.com/Pengopal/ai-usage-tracker-widget/releases'));
}

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  app.setAppUserModelId('com.mufurqan.aiusagetracker');
  store = new Store(app.getPath('userData'));
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

app.on('before-quit', () => { quitting = true; });
// Hidden sync windows count as windows; quitting is driven by the tray / close button.
app.on('window-all-closed', () => {});
