// Tiny JSON-file store kept in Electron's userData folder.
const fs = require('fs');
const path = require('path');

const HISTORY_KEEP_MS = 7 * 24 * 3600 * 1000;
const HISTORY_MIN_GAP_MS = 5 * 60 * 1000;

const DEFAULTS = {
  // Last values read from claude.ai / grok.com, kept so the widget has something
  // to show at startup before the first sync finishes.
  claude: { connected: false, session: null, weekly: null, extra: [], plan: null, lastSync: null, error: null },
  grok: { connected: false, pct: null, remaining: null, total: null, unit: null, windowSeconds: null, reset: null, lastSync: null, error: null },
  settings: {
    alwaysOnTop: true,
    notifications: true,
    thresholds: [75, 90, 100],
    paceAlerts: true,
    backAlerts: true,
    minimizeToTray: true,
    view: 'bars',
    grokModel: '',
  },
  notified: {},
  lastPct: {},
  bounds: null,
};

function cleanThresholds(list) {
  const nums = (Array.isArray(list) ? list : [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULTS.settings, ...(r.settings || {}) };
  settings.thresholds = cleanThresholds(settings.thresholds);
  if (!['bars', 'rings'].includes(settings.view)) settings.view = 'bars';
  return {
    claude: { ...DEFAULTS.claude, ...(r.claude && 'connected' in r.claude ? r.claude : {}) },
    grok: { ...DEFAULTS.grok, ...(r.grok && 'connected' in r.grok ? r.grok : {}) },
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
    this.data = normalize(readJson(this.file, DEFAULTS));
    const h = readJson(this.historyFile, []);
    this.history = Array.isArray(h) ? h : [];
  }

  save() {
    writeJson(this.file, this.data);
  }

  set(partial) {
    this.data = normalize({ ...this.data, ...partial });
    this.save();
    return this.data;
  }

  // One reading per sync when something moved, otherwise one every 5 minutes.
  addSample(sample) {
    const last = this.history[this.history.length - 1];
    const same = last && ['cs', 'cw', 'g'].every((k) => last[k] === sample[k]);
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

module.exports = { Store, normalize, cleanThresholds };
