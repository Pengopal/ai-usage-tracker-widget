// Reads real usage from claude.ai, chatgpt.com and grok.com using a session the
// user signs in to once inside the app. Requests run inside a hidden window on
// each site, so they carry the site's own cookies exactly like the official
// usage pages do.
//
// These are the sites' internal endpoints, not public APIs; they can change.
const { BrowserWindow, session } = require('electron');
const { parseClaude, parseOpenAI, parseGrok } = require('./parsers');

function chromeUserAgent() {
  const major = process.versions.chrome.split('.')[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

const CLAUDE_JS = `(async () => {
  const get = async (url) => {
    const r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const orgs = await get('/api/organizations');
  if (orgs.status === 401 || orgs.status === 403) return { auth: false };
  if (orgs.status !== 200 || !Array.isArray(orgs.body)) return { auth: true, error: 'organizations HTTP ' + orgs.status };
  // Prefer the org that carries the paid chat plan.
  const rank = (o) => {
    const caps = o.capabilities || [];
    if (caps.some((c) => /claude_(pro|max)/.test(c))) return 0;
    if (caps.includes('chat')) return 1;
    return 2;
  };
  const list = orgs.body.slice().sort((a, b) => rank(a) - rank(b));
  for (const o of list) {
    const u = await get('/api/organizations/' + o.uuid + '/usage');
    if (u.status === 200 && u.body && (u.body.five_hour || u.body.seven_day)) {
      return { auth: true, org: { capabilities: o.capabilities, rate_limit_tier: o.rate_limit_tier }, usage: u.body };
    }
  }
  return { auth: true, error: 'No usage data found for this account' };
})()`;

// ChatGPT's session endpoint hands the page a short-lived access token; the
// usage call needs it as a bearer token. The token never leaves this page.
const OPENAI_JS = `(async () => {
  try {
    const s = await fetch('/api/auth/session', { credentials: 'include', headers: { accept: 'application/json' } });
    let sess = null;
    try { sess = await s.json(); } catch {}
    if (!sess || !sess.accessToken) return { auth: false };
    const plan = (sess.account && (sess.account.planType || sess.account.plan_type)) || null;
    const r = await fetch('/backend-api/wham/usage', {
      credentials: 'include',
      headers: { accept: 'application/json', authorization: 'Bearer ' + sess.accessToken },
    });
    let body = null;
    try { body = await r.json(); } catch {}
    if (r.status === 401) return { auth: false };
    if (r.status !== 200) return { auth: true, plan, error: 'usage HTTP ' + r.status };
    return { auth: true, plan, usage: body };
  } catch (err) {
    return { auth: true, error: err && err.message ? err.message : 'usage request failed' };
  }
})()`;

// Signed-in usage on grok.com. The usage page calls GetGrokCreditsConfig, which
// the site now serves as GET /rest/grok/credits (weekly pool, reset, used %).
// POST /rest/rate-limits is the old rolling query window and is only a fallback.
const grokJs = (model) => `(async () => {
  const modelName = ${JSON.stringify(model || '')};
  const read = async (url, init) => {
    const r = await fetch(url, { credentials: 'include', ...(init || {}) });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  const unauth = (res) => res.status === 401 || res.status === 403
    || (res.json && (res.json.code === 16 || res.json.code === 'unauthenticated' || res.json.code === 'permission_denied'));
  const creditsBody = (json) => {
    if (!json || typeof json !== 'object') return null;
    const l = json.config && typeof json.config === 'object' ? json.config : json;
    if (l.creditUsagePercent != null || l.credit_usage_percent != null || l.currentPeriod || l.current_period
      || l.billingPeriodEnd || l.billing_period_end || l.monthlyLimit || l.monthly_limit) return json;
    return null;
  };
  try {
    const credits = await read('/rest/grok/credits', { headers: { accept: 'application/json' } });
    if (unauth(credits)) return { auth: false };
    if (creditsBody(credits.json)) return { auth: true, limits: credits.json };
    // Credits missing or not the usage shape: try the older query window.
    const body = { requestKind: 'DEFAULT' };
    if (modelName) body.modelName = modelName;
    const legacy = await read('/rest/rate-limits', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    // A 200 from credits means the session is signed in, even if this route is not.
    if (unauth(legacy) && credits.status !== 200) return { auth: false };
    const lim = legacy.json;
    if (legacy.status === 200 && lim && (lim.totalQueries > 0 || lim.totalTokens > 0 || lim.remainingQueries != null || lim.remainingTokens != null)) {
      return { auth: true, limits: lim };
    }
    if (credits.status === 200) return { auth: true, error: 'Unrecognised usage response' };
    return { auth: true, error: 'usage HTTP ' + (legacy.status !== 200 ? legacy.status : credits.status) };
  } catch (err) {
    return { auth: true, error: err && err.message ? err.message : 'usage request failed' };
  }
})()`;

class Service {
  constructor({ id, name, home, loginUrl, partition, script, parse }) {
    Object.assign(this, { id, name, home, loginUrl, partition, script, parse });
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

  // One sync: { connected, windows, plan, detail, error, raw }.
  async read(options = {}) {
    const js = typeof this.script === 'function' ? this.script(options) : this.script;
    const res = await this.run(js);
    if (!res.auth) return { connected: false, raw: res };
    if (res.error) return { connected: true, error: res.error, raw: res };
    const parsed = this.parse(res, Date.now());
    if (parsed.error) return { connected: true, error: parsed.error, raw: res };
    return { connected: true, ...parsed, raw: res };
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

const services = {
  claude: new Service({
    id: 'claude',
    name: 'Claude',
    home: 'https://claude.ai/settings/usage',
    loginUrl: 'https://claude.ai/login',
    partition: 'persist:claude',
    script: CLAUDE_JS,
    parse: parseClaude,
  }),
  openai: new Service({
    id: 'openai',
    name: 'ChatGPT',
    home: 'https://chatgpt.com/',
    loginUrl: 'https://chatgpt.com/auth/login',
    partition: 'persist:openai',
    script: OPENAI_JS,
    parse: parseOpenAI,
  }),
  grok: new Service({
    id: 'grok',
    name: 'Grok',
    home: 'https://grok.com/?_s=usage',
    loginUrl: 'https://grok.com/sign-in',
    partition: 'persist:grok',
    script: ({ grokModel }) => grokJs(grokModel),
    parse: parseGrok,
  }),
};

module.exports = { services };
