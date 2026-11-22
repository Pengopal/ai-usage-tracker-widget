// Reads real usage from claude.ai, chatgpt.com and grok.com using a session the
// user signs in to once inside the app. The shared core readers run inside a
// hidden window on each site, so their requests carry the site's own cookies
// exactly like the official usage pages do.
const { BrowserWindow, session } = require('electron');
const readers = require('./core/readers');
const { interpret } = require('./core/interpret');
const CATALOG = require('./core/catalog.json');

function chromeUserAgent() {
  const major = process.versions.chrome.split('.')[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

// A reader call as a script for executeJavaScript.
const callReader = (id, arg) => `(${readers[id]})(${JSON.stringify(arg ?? null)})`;

class Service {
  constructor({ id, name, home, loginUrl, partition, arg }) {
    Object.assign(this, { id, name, home, loginUrl, partition, arg });
    this.worker = null;
    this.workerReady = null;
    this.loginWin = null;
    this.uaSet = false;
  }

  windowOptions(show) {
    // Sessions only exist once the app is ready, so the user agent is set lazily.
    if (!this.uaSet) {
      session.fromPartition(this.partition).setUserAgent(chromeUserAgent());
      this.uaSet = true;
    }
    return {
      show,
      width: 480,
      height: 760,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { partition: this.partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    };
  }

  ensureWorker() {
    if (this.worker && !this.worker.isDestroyed()) return this.workerReady;
    this.worker = new BrowserWindow(this.windowOptions(false));
    this.worker.webContents.setAudioMuted(true);
    this.worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.workerReady = new Promise((resolve, reject) => {
      const wc = this.worker.webContents;
      const timer = setTimeout(() => reject(new Error(`Timed out loading ${this.home}`)), 45000);
      wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      wc.once('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
        if (isMainFrame) { clearTimeout(timer); reject(new Error(`Can't reach ${this.home} (${desc || code})`)); }
      });
    });
    this.worker.loadURL(this.home).catch(() => {});
    this.workerReady.catch(() => this.dropWorker());
    return this.workerReady;
  }

  dropWorker() {
    if (this.worker && !this.worker.isDestroyed()) this.worker.destroy();
    this.worker = null;
  }

  async run(js) {
    await this.ensureWorker();
    try {
      return await this.worker.webContents.executeJavaScript(js, true);
    } catch (err) {
      // A reload or navigation in the worker interrupts the call; start fresh next time.
      this.dropWorker();
      throw err;
    }
  }

  // One sync: { connected, windows?, plan?, detail?, error?, raw }.
  async read(options = {}) {
    const res = await this.run(callReader(this.id, this.arg ? this.arg(options) : null));
    return { ...interpret(this.id, res, Date.now()), raw: res };
  }

  // Opens the real sign-in page in its own window and calls onDone once the
  // session can read usage (or the user closes the window).
  openLogin(probe, onDone) {
    if (this.loginWin && !this.loginWin.isDestroyed()) {
      this.loginWin.focus();
      return;
    }
    const win = new BrowserWindow({
      ...this.windowOptions(true),
      center: true,
      title: `Sign in to ${this.name} · AI Usage`,
    });
    this.loginWin = win;
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: this.windowOptions(true),
    }));
    win.loadURL(this.loginUrl);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      onDone();
    };
    const poll = setInterval(async () => {
      try {
        if (await probe()) {
          if (!win.isDestroyed()) win.close();
          finish();
        }
      } catch {}
    }, 3000);
    win.on('closed', () => {
      this.loginWin = null;
      finish();
    });
  }

  async signOut() {
    this.dropWorker();
    await session.fromPartition(this.partition).clearStorageData();
  }
}

const ARGS = { grok: ({ grokModel }) => grokModel || '' };

const services = Object.fromEntries(Object.entries(CATALOG).map(([id, p]) => [id, new Service({
  id,
  name: p.name,
  home: p.home,
  loginUrl: p.loginUrl,
  partition: `persist:${id}`,
  arg: ARGS[id],
})]));

module.exports = { services };
