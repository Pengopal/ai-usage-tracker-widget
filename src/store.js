// Tiny JSON-file store kept in Electron's userData folder.
const fs = require('fs');
const path = require('path');
const { PROVIDER_IDS, emptyService, defaultProviderSettings } = require('./providers');
const { migrateSample } = require('./insights');

const HISTORY_KEEP_MS = 7 * 24 * 3600 * 1000;
const HISTORY_MIN_GAP_MS = 5 * 60 * 1000;

const DEFAULT_SETTINGS = {
  alwaysOnTop: true,
  notifications: true,
  thresholds: [75, 90, 100],
  paceAlerts: true,
  backAlerts: true,
  minimizeToTray: true,
  view: 'bars',
  grokModel: '',
};

function cleanThresholds(list) {
  const nums = (Array.isArray(list) ? list : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return [...new Set(nums)].sort((a, b) => a - b);
}

// v1.1 kept claude { session, weekly, plan } and grok { pct, reset, … } at the top level.
function migrateService(id, old) {
  if (!old || typeof old !== 'object') return null;
  if (id === 'claude' && ('session' in old || 'weekly' in old)) {
    const plan = old.plan ? (old.plan.includes('max') ? 'max' : 'pro') : null;
    return { ...emptyService(), connected: !!old.connected, windows: { session: old.session, weekly: old.weekly }, plan, lastSync: old.lastSync, error: old.error };
  }
  if (id === 'grok' && 'pct' in old) {
    const windows = old.pct != null ? { weekly: { pct: old.pct, reset: old.reset } } : {};
    const detail = old.total != null ? { remaining: old.remaining, total: old.total, unit: old.unit } : null;
    return { ...emptyService(), connected: !!old.connected, windows, detail, lastSync: old.lastSync, error: old.error };
  }
  return null;
}

function normalizeService(raw) {
  const s = { ...emptyService(), ...(raw && typeof raw === 'object' ? raw : {}) };
  // Drop empty windows so "no data" is just a missing key.
  s.windows = Object.fromEntries(Object.entries(s.windows || {}).filter(([, w]) => w && w.pct != null));
  return s;
}

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULT_SETTINGS, ...(r.settings || {}) };
  settings.thresholds = cleanThresholds(settings.thresholds);
  if (!['bars', 'rings'].includes(settings.view)) settings.view = 'bars';
  const providers = defaultProviderSettings();
  for (const id of PROVIDER_IDS) {
    const p = r.settings?.providers?.[id];
    if (p) providers[id] = { enabled: p.enabled !== false, plan: typeof p.plan === 'string' ? p.plan : 'auto' };
  }
  settings.providers = providers;

  const services = {};
  for (const id of PROVIDER_IDS) {
    services[id] = normalizeService(r.services?.[id] || migrateService(id, r[id]));
  }
  return {
    services,
    settings,
    notified: r.notified && typeof r.notified === 'object' ? r.notified : {},
    lastPct: r.lastPct && typeof r.lastPct === 'object' ? r.lastPct : {},
    bounds: r.bounds || null,
  };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'usage-data.json');
    this.historyFile = path.join(dir, 'history.json');
    this.data = normalize(readJson(this.file, {}));
    const h = readJson(this.historyFile, []);
    this.history = (Array.isArray(h) ? h : []).map(migrateSample).filter(Boolean);
  }

  save() {
    writeJson(this.file, this.data);
  }

  set(partial) {
    this.data = normalize({ ...this.data, ...partial });
    this.save();
    return this.data;
  }

  setService(id, value) {
    return this.set({ services: { ...this.data.services, [id]: value } });
  }

  // One reading per sync when something moved, otherwise one every 5 minutes.
  addSample(sample) {
    const last = this.history[this.history.length - 1];
    const same = last && JSON.stringify(last.v) === JSON.stringify(sample.v);
    if (last && same && sample.t - last.t < HISTORY_MIN_GAP_MS) return;
    this.history.push(sample);
    this.history = this.history.filter((s) => sample.t - s.t <= HISTORY_KEEP_MS);
    try { writeJson(this.historyFile, this.history); } catch {}
  }

  // Raw responses from the last sync, for diagnosing endpoint changes.
  writeDebug(name, raw) {
    try {
      fs.writeFileSync(path.join(this.dir, `sync-debug-${name}.json`), JSON.stringify({ at: new Date().toISOString(), raw }, null, 2));
    } catch {}
  }
}

module.exports = { Store, normalize, cleanThresholds, DEFAULT_SETTINGS };
