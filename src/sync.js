// Reads real usage from claude.ai and grok.com using a session the user signs in to
// once inside the app. Requests run inside a hidden window on each site, so they
// carry the site's own cookies exactly like the official usage pages do.
//
// These are the sites' internal endpoints, not public APIs; they can change.
const { BrowserWindow, session } = require('electron');

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
      return { auth: true, org: { name: o.name, capabilities: o.capabilities }, usage: u.body };
    }
  }
  return { auth: true, error: 'No usage data found for this account' };
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

const pct = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Math.round(Number(v) * 10) / 10)) : 0);

function parseClaude(res) {
  const u = res.usage;
  const window = (w) => (w ? { pct: pct(w.utilization), reset: w.resets_at || null } : null);
  return {
    session: window(u.five_hour),
    weekly: window(u.seven_day),
    // Model-specific weekly caps (e.g. Opus) appear on some plans.
    extra: Object.entries(u)
      .filter(([k, v]) => k.startsWith('seven_day_') && v && v.utilization != null)
      .map(([k, v]) => ({ key: k, label: k.replace('seven_day_', '').replace(/_/g, ' '), ...window(v) })),
    plan: (res.org.capabilities || []).find((c) => /claude_(pro|max)/.test(c)) || null,
  };
}

const finite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// Cent / credit amounts arrive as { val } or a bare number.
const amount = (v) => (v != null && typeof v === 'object' ? finite(v.val) : finite(v));

// Weekly (or monthly) included pool from GetGrokCreditsConfig. An omitted
// percent on a known period is 0% — proto3 does not send the zero scalar.
function creditsWindow(l) {
  const period = l.currentPeriod || l.current_period || null;
  let used = finite(l.creditUsagePercent ?? l.credit_usage_percent ?? l.usagePercent ?? l.usedPercent);
  const stamp = (v) => {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v.seconds != null) {
      const ms = Number(v.seconds) * 1000 + Number(v.nanos || 0) / 1e6;
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    return null;
  };
  const end = stamp((period && (period.end || period.End)) || l.billingPeriodEnd || l.billing_period_end || l.resetsAt);
  const start = stamp((period && (period.start || period.Start)) || l.billingPeriodStart || l.billing_period_start);
  const type = String((period && (period.type || period.periodType || period.period_type)) || '');
  if (used == null && finite(l.remainingPercent) != null) used = 100 - finite(l.remainingPercent);
  if (used == null) {
    const limit = amount(l.monthlyLimit ?? l.monthly_limit);
    const spent = amount(l.used);
    if (limit > 0 && spent != null) used = (spent / limit) * 100;
    else if (end || type === '1' || type === '2' || /WEEKLY|MONTHLY/i.test(type)) used = 0;
  }
  if (used == null) return null;
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  let windowSeconds = null;
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) windowSeconds = Math.round((endMs - startMs) / 1000);
  else if (type === '2' || /WEEKLY/i.test(type)) windowSeconds = 7 * 24 * 3600;
  else if (type === '1' || /MONTHLY/i.test(type)) windowSeconds = 30 * 24 * 3600;
  const usedPct = pct(used);
  return {
    pct: usedPct,
    remaining: Math.round((100 - usedPct) * 10) / 10,
    total: null,
    unit: null,
    windowSeconds,
    reset: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
  };
}

function parseGrok(res, now) {
  const raw = res.limits || {};
  const l = raw.config && typeof raw.config === 'object' ? raw.config : raw;
  let remaining = l.remainingQueries;
  let total = l.totalQueries;
  let unit = 'queries';
  if (!(total > 0) && l.totalTokens > 0) {
    remaining = l.remainingTokens;
    total = l.totalTokens;
    unit = 'tokens';
  }
  // Query/token windows are the old rolling limit. Everything else is the usage pool.
  if (!(total > 0)) {
    const credits = creditsWindow(l);
    return credits || { error: 'Unrecognised rate-limit response' };
  }
  const used = Math.max(0, total - Math.max(0, remaining));
  const windowSeconds = Number(l.windowSizeSeconds) || null;
  // When the pool is empty Grok reports how long until capacity frees up.
  const wait = Number(l.waitTimeSeconds);
  const reset = wait > 0 ? new Date(now + wait * 1000).toISOString() : null;
  return { pct: pct((used / total) * 100), remaining, total, unit, windowSeconds, reset };
}

class Service {
  constructor({ id, home, loginUrl, partition }) {
    this.id = id;
    this.home = home;
    this.loginUrl = loginUrl;
    this.partition = partition;
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

  // Opens the site's real sign-in page; resolves once the session can read usage.
  openLogin(probe, onDone) {
    if (this.loginWin && !this.loginWin.isDestroyed()) {
      this.loginWin.focus();
      return;
    }
    const win = new BrowserWindow({
      ...this.windowOptions(true),
      center: true,
      title: `Sign in to ${this.id === 'claude' ? 'Claude' : 'Grok'} · AI Usage`,
    });
    this.loginWin = win;
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: this.windowOptions(true),
    }));
    win.loadURL(this.loginUrl);
    const poll = setInterval(async () => {
      try {
        if (await probe()) {
          clearInterval(poll);
          if (!win.isDestroyed()) win.close();
          onDone();
        }
      } catch {}
    }, 3000);
    win.on('closed', () => {
      clearInterval(poll);
      this.loginWin = null;
      onDone();
    });
  }

  async signOut() {
    this.dropWorker();
    await session.fromPartition(this.partition).clearStorageData();
  }
}

const claude = new Service({
  id: 'claude',
  home: 'https://claude.ai/settings/usage',
  loginUrl: 'https://claude.ai/login',
  partition: 'persist:claude',
});
claude.browserUrl = 'https://claude.ai/settings/usage';

const grok = new Service({
  id: 'grok',
  home: 'https://grok.com/?_s=usage',
  loginUrl: 'https://grok.com/sign-in',
  partition: 'persist:grok',
});
grok.browserUrl = 'https://grok.com/';

async function syncClaude() {
  const res = await claude.run(CLAUDE_JS);
  if (!res.auth) return { connected: false, raw: res };
  if (res.error) return { connected: true, error: res.error, raw: res };
  return { connected: true, ...parseClaude(res), raw: res };
}

async function syncGrok(model) {
  const res = await grok.run(grokJs(model));
  if (!res.auth) return { connected: false, raw: res };
  if (res.error) return { connected: true, error: res.error, raw: res };
  return { connected: true, ...parseGrok(res, Date.now()), raw: res };
}

module.exports = { claude, grok, syncClaude, syncGrok, parseClaude, parseGrok };
