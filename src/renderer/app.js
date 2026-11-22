const REFRESH_MS = 60 * 1000;
const MINUTE = 60 * 1000;
const STALE_MS = 5 * MINUTE;
const RING_LEN = 2 * Math.PI * 18;
const SERVICES = ['claude', 'grok'];

let data = null;
let mode = 'widget'; // or 'settings'

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function level(pct) {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

function formatDuration(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / MINUTE));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeText(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Current reading for a metric id, in one shape for both services.
function metric(id) {
  if (id === 'grok') {
    const g = data.grok;
    return { service: 'grok', pct: g.pct, reset: g.reset, connected: g.connected, total: g.total, remaining: g.remaining, unit: g.unit };
  }
  const c = data.claude;
  const w = id === 'claude.session' ? c.session : c.weekly;
  return { service: 'claude', pct: w?.pct ?? null, reset: w?.reset ?? null, connected: c.connected };
}

function untilReset(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  return ms > 0 ? ms : 0;
}

function sparkPoints(series, now) {
  if (!series || series.length < 2) return '';
  const t0 = series[0][0];
  const span = Math.max(now - t0, MINUTE);
  return series.map(([t, v]) => `${(((t - t0) / span) * 48).toFixed(1)},${(14 - (Math.min(100, v) / 100) * 14).toFixed(1)}`).join(' ');
}

// ---------- Bars view ----------
function renderMeter(el, id, now) {
  const m = metric(id);
  const p = m.pct ?? 0;
  el.classList.remove('ok', 'warn', 'danger');
  el.classList.add(level(p));
  el.querySelector('.pct').textContent = m.pct == null ? '—' : `${Math.round(p)}%`;
  el.querySelector('.fill').style.width = `${Math.min(100, p)}%`;
  el.querySelector('.spark polyline').setAttribute('points', sparkPoints(data.insights?.spark?.[id], now));

  const reset = el.querySelector('.reset');
  const left = untilReset(m.reset, now);
  if (left == null) {
    reset.textContent = id === 'claude.session' && !m.pct ? 'Not started' : id === 'grok' ? '' : 'Reset time unknown';
    reset.removeAttribute('title');
  } else {
    reset.textContent = left === 0 ? 'Resetting…' : `Resets in ${formatDuration(left)}`;
    reset.title = new Date(m.reset).toLocaleString();
  }

  const pace = el.querySelector('.pace');
  const eta = data.insights?.pace?.[id];
  if (eta != null) {
    pace.textContent = `Out in ~${formatDuration(eta)}`;
    pace.title = 'At your pace over the last hour, this limit runs out before it resets';
    pace.classList.add('alert');
  } else {
    pace.textContent = m.total != null ? `${m.remaining}/${m.total} ${m.unit} left` : '';
    pace.removeAttribute('title');
    pace.classList.remove('alert');
  }
}

function renderBars(now) {
  for (const name of SERVICES) {
    const s = data[name];
    $(`p-${name}`).classList.toggle('offline', !s.connected);
    $(`${name}-error`).textContent = s.error ? `Sync problem: ${s.error}` : '';
  }
  $('claude-plan').textContent = data.claude.plan ? (data.claude.plan.includes('max') ? 'Max' : 'Pro') : '';
  $$('#bars .meter').forEach((el) => renderMeter(el, el.dataset.metric, now));
}

// ---------- Ring view ----------
function renderRings(now) {
  $$('#rings .ring').forEach((el) => {
    const id = el.dataset.metric;
    const m = metric(id);
    const p = m.connected && m.pct != null ? m.pct : 0;
    el.classList.toggle('offline', !m.connected);
    el.classList.remove('ok', 'warn', 'danger');
    el.classList.add(level(p));
    const arc = el.querySelector('.arc');
    arc.style.strokeDasharray = RING_LEN;
    arc.style.strokeDashoffset = RING_LEN * (1 - Math.min(100, p) / 100);
    el.querySelector('.ring-pct').textContent = m.connected && m.pct != null ? `${Math.round(p)}%` : '—';
    const sub = el.querySelector('.ring-sub');
    const eta = data.insights?.pace?.[id];
    const left = untilReset(m.reset, now);
    if (!m.connected) sub.textContent = 'Sign in';
    else if (eta != null) sub.textContent = `out ~${formatDuration(eta)}`;
    else sub.textContent = left ? formatDuration(left) : '';
    el.title = m.connected && m.reset ? `Resets ${new Date(m.reset).toLocaleString()}` : '';
  });
}

// ---------- Title bar ----------
function renderTitle(now) {
  const last = SERVICES.map((n) => data[n].lastSync).filter(Boolean).sort().pop();
  const anyConnected = SERVICES.some((n) => data[n].connected);
  const anyError = SERVICES.some((n) => data[n].connected && data[n].error);
  const dot = $('status-dot');
  dot.className = 'status-dot';
  if (data.syncing) dot.classList.add('busy');
  else if (anyConnected && (anyError || !last || now - Date.parse(last) > STALE_MS)) dot.classList.add('stale');
  else if (anyConnected) dot.classList.add('ok');
  dot.title = data.syncing ? 'Syncing' : last ? `Last synced ${timeText(last)}` : 'Not synced yet';

  $('updated').textContent = mode === 'settings' || data.settings.view === 'rings' ? '' : last ? timeText(last) : '';
  $('btn-sync').classList.toggle('spinning', !!data.syncing);
  $('btn-pin').setAttribute('aria-pressed', String(data.settings.alwaysOnTop));
  $('btn-pin').title = data.settings.alwaysOnTop ? 'Always on top: on' : 'Always on top: off';
  const rings = data.settings.view === 'rings';
  $('btn-view').title = rings ? 'Detailed view' : 'Compact ring view';
  $('btn-view').querySelector('use').setAttribute('href', rings ? '#i-bars' : '#i-rings');
  const up = data.update || {};
  $('btn-update').classList.toggle('hidden', up.status !== 'ready');
  $('btn-update').title = up.version ? `Restart to install v${up.version}` : 'Restart to update';
}

// ---------- Settings ----------
function updateText(up) {
  switch (up.status) {
    case 'checking': return 'Checking for updates…';
    case 'current': return 'Up to date';
    case 'downloading': return `Downloading v${up.version}… ${up.progress ?? 0}%`;
    case 'ready': return `v${up.version} ready to install`;
    case 'error': return `Update check failed: ${up.error}`;
    case 'portable': return 'Portable build: get new versions from GitHub';
    case 'dev': return 'Updates run in the installed app';
    default: return '';
  }
}

function renderSettings() {
  for (const name of SERVICES) {
    const s = data[name];
    const box = document.querySelector(`[data-account="${name}"]`);
    const status = box.querySelector('.account-status');
    status.textContent = s.connected
      ? s.lastSync ? `Connected · synced ${timeText(s.lastSync)}` : 'Connected'
      : 'Not signed in';
    status.classList.toggle('ok', s.connected);
    const btn = box.querySelector('.account-btn');
    btn.textContent = s.connected ? 'Sign out' : 'Sign in';
    btn.classList.toggle('primary', !s.connected);
  }
  const up = data.update || {};
  $('about-version').textContent = `Version ${data.version}`;
  $('about-update').textContent = updateText(up);
  const action = $('btn-update-action');
  action.textContent = up.status === 'ready' ? 'Restart to update' : up.status === 'portable' ? 'Open releases' : 'Check for updates';
  action.disabled = up.status === 'checking' || up.status === 'downloading' || up.status === 'dev';
  action.classList.toggle('primary', up.status === 'ready');
}

function fillForm() {
  const s = data.settings;
  $('set-notify').checked = s.notifications;
  $('set-thresholds').value = s.thresholds.join(', ');
  $('set-pace').checked = s.paceAlerts;
  $('set-back').checked = s.backAlerts;
  $('set-rings').checked = s.view === 'rings';
  $('set-ontop').checked = s.alwaysOnTop;
  $('set-tray').checked = s.minimizeToTray;
  $('set-grok-model').value = s.grokModel || '';
}

async function savePatch(patch) {
  data = await window.api.saveSettings(patch);
  render();
}

// ---------- Layout ----------
function render() {
  if (!data) return;
  const now = Date.now();
  const rings = data.settings.view === 'rings';
  document.body.dataset.view = rings ? 'rings' : 'bars';
  document.body.dataset.mode = mode;
  $('bars').classList.toggle('hidden', mode !== 'widget' || rings);
  $('rings').classList.toggle('hidden', mode !== 'widget' || !rings);
  $('settings').classList.toggle('hidden', mode !== 'settings');
  $('title-text').textContent = mode === 'settings' ? 'Settings' : 'Usage';
  renderTitle(now);
  if (mode === 'settings') renderSettings();
  else if (rings) renderRings(now);
  else renderBars(now);
  fit();
}

// Sizes the window to its content so the widget never shows empty space.
let fitFrame = 0;
function fit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const view = mode === 'settings' ? $('settings') : data.settings.view === 'rings' ? $('rings') : $('bars');
    const inner = view.querySelector('.inner');
    const chrome = document.querySelector('.titlebar').offsetHeight + 2; // + body border
    const height = chrome + inner.offsetHeight;
    window.api.fit(mode, mode === 'settings' ? Math.min(height, 620) : height);
  });
}

function showSettings(open) {
  mode = open ? 'settings' : 'widget';
  if (open) fillForm();
  $('settings').scrollTop = 0;
  render();
}

function wire() {
  $('btn-settings').addEventListener('click', () => showSettings(true));
  $('settings').addEventListener('submit', (e) => { e.preventDefault(); showSettings(false); });
  $('btn-sync').addEventListener('click', () => window.api.syncNow());
  $('btn-view').addEventListener('click', () => window.api.setView(data.settings.view === 'rings' ? 'bars' : 'rings'));
  $('btn-pin').addEventListener('click', async () => {
    data.settings.alwaysOnTop = await window.api.toggleAlwaysOnTop();
    render();
  });
  $('btn-close').addEventListener('click', () => (mode === 'settings' ? showSettings(false) : window.api.windowAction('close')));
  $('btn-update').addEventListener('click', () => window.api.installUpdate());
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => window.api.openUrl(b.dataset.open)));
  $$('[data-signin]').forEach((b) => b.addEventListener('click', () => window.api.signIn(b.dataset.signin)));
  $$('#rings .ring').forEach((el) => el.addEventListener('click', () => {
    if (el.classList.contains('offline')) window.api.signIn(el.dataset.service);
  }));

  for (const name of SERVICES) {
    document.querySelector(`[data-account="${name}"] .account-btn`).addEventListener('click', async () => {
      if (data[name].connected) {
        data = await window.api.signOut(name);
        render();
      } else {
        window.api.signIn(name);
      }
    });
  }

  // Settings apply as soon as they change.
  const toggles = {
    'set-notify': 'notifications',
    'set-pace': 'paceAlerts',
    'set-back': 'backAlerts',
    'set-ontop': 'alwaysOnTop',
    'set-tray': 'minimizeToTray',
  };
  for (const [id, key] of Object.entries(toggles)) {
    $(id).addEventListener('change', (e) => savePatch({ [key]: e.target.checked }));
  }
  $('set-rings').addEventListener('change', (e) => window.api.setView(e.target.checked ? 'rings' : 'bars'));
  $('set-thresholds').addEventListener('change', async (e) => {
    const list = e.target.value.split(/[\s,;]+/).filter(Boolean).map(Number);
    await savePatch({ thresholds: list });
    e.target.value = data.settings.thresholds.join(', ');
  });
  $('set-grok-model').addEventListener('change', (e) => savePatch({ grokModel: e.target.value.trim() }));
  $('btn-update-action').addEventListener('click', () => {
    const s = data.update?.status;
    if (s === 'ready') window.api.installUpdate();
    else if (s === 'portable') window.api.openReleases();
    else window.api.checkUpdate();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'settings') showSettings(false);
  });

  window.api.onData((d) => {
    data = d;
    if (mode === 'settings') $('set-rings').checked = d.settings.view === 'rings';
    render();
  });
}

async function init() {
  wire();
  data = await window.api.getData();
  render();
  // Re-render on each wall-clock minute so countdowns tick over exactly.
  const msToNextMinute = MINUTE - (Date.now() % MINUTE);
  setTimeout(() => {
    render();
    setInterval(render, REFRESH_MS);
  }, msToNextMinute + 50);
}

init();
