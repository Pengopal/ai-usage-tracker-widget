const REFRESH_MS = 60 * 1000;
const MINUTE = 60 * 1000;
const STALE_MS = 5 * MINUTE;
const RING_LEN = 2 * Math.PI * 18;
const RING_WIDTH = 76;

let data = null;
let mode = 'widget'; // or 'settings'

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => root.querySelectorAll(sel);
const clone = (id) => $(id).content.firstElementChild.cloneNode(true);

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

function untilReset(iso, now) {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  return ms > 0 ? ms : 0;
}

function setLogo(svg, row) {
  svg.querySelector('use').setAttribute('href', `#${row.logo}`);
  svg.classList.toggle('claude', row.id === 'claude');
}

// The countdown shown next to a limit's name.
function resetText(m, now) {
  const left = untilReset(m.reset, now);
  if (left != null) {
    return { text: left === 0 ? 'Resetting…' : `Resets in ${formatDuration(left)}`, title: new Date(m.reset).toLocaleString() };
  }
  if (m.detail && m.detail.total != null) return { text: `${m.detail.remaining}/${m.detail.total} ${m.detail.unit} left` };
  return { text: '' };
}

// ---------- Bars view ----------
function renderBars(now) {
  const list = $('bars-list');
  const nodes = data.rows.map((row) => {
    const el = clone('tpl-provider');
    el.classList.toggle('offline', !row.connected);
    setLogo(el.querySelector('.logo'), row);
    el.querySelector('.provider-name').textContent = row.name;
    el.querySelector('.plan').textContent = row.plan || '';
    el.querySelector('.open').addEventListener('click', () => window.api.openUrl(row.id));
    el.querySelector('.signin').addEventListener('click', () => window.api.signIn(row.id));
    el.querySelector('.card-error').textContent = row.error ? `Sync problem: ${row.error}` : '';

    const metrics = el.querySelector('.metrics');
    for (const m of row.metrics) {
      const meter = clone('tpl-meter');
      meter.classList.add(level(m.pct));
      meter.querySelector('.label').textContent = m.label;
      meter.querySelector('.pct').textContent = `${Math.round(m.pct)}%`;
      meter.querySelector('.fill').style.width = `${Math.min(100, m.pct)}%`;
      const reset = resetText(m, now);
      const r = meter.querySelector('.reset');
      r.textContent = reset.text;
      if (reset.title) r.title = reset.title;
      metrics.append(meter);
    }
    if (row.connected && !row.metrics.length && !row.error) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No limits reported for this plan yet';
      metrics.append(note);
    }
    return el;
  });
  if (!nodes.length) {
    const note = document.createElement('div');
    note.className = 'all-hidden';
    note.textContent = 'All providers are hidden. Turn one on in Settings.';
    nodes.push(note);
  }
  list.replaceChildren(...nodes);
}

// ---------- Ring view ----------
function ringFor(row, m, now) {
  const el = clone('tpl-ring');
  setLogo(el.querySelector('.mini-logo'), row);
  el.querySelector('.ring-label span').textContent = m ? (row.metrics.length > 1 ? m.label : row.name) : row.name;
  const arc = el.querySelector('.arc');
  arc.style.strokeDasharray = RING_LEN;
  const sub = el.querySelector('.ring-sub');
  if (!m) {
    el.classList.add('offline');
    arc.style.strokeDashoffset = RING_LEN;
    el.querySelector('.ring-pct').textContent = '—';
    sub.textContent = row.connected ? 'No data' : 'Sign in';
    if (!row.connected) el.addEventListener('click', () => window.api.signIn(row.id));
    el.title = row.name;
    return el;
  }
  el.classList.add(level(m.pct));
  arc.style.strokeDashoffset = RING_LEN * (1 - Math.min(100, m.pct) / 100);
  el.querySelector('.ring-pct').textContent = `${Math.round(m.pct)}%`;
  const left = untilReset(m.reset, now);
  sub.textContent = left ? formatDuration(left) : '';
  el.title = `${row.name} ${m.label}${m.reset ? ` · resets ${new Date(m.reset).toLocaleString()}` : ''}`;
  return el;
}

function renderRings(now) {
  const rings = [];
  for (const row of data.rows) {
    if (row.connected && row.metrics.length) row.metrics.forEach((m) => rings.push(ringFor(row, m, now)));
    else rings.push(ringFor(row, null, now));
  }
  $('ring-list').replaceChildren(...rings);
  return rings.length;
}

// ---------- Title bar ----------
function renderTitle(now) {
  const connected = data.rows.filter((r) => r.connected);
  const last = connected.map((r) => r.lastSync).filter(Boolean).sort().pop();
  const anyError = connected.some((r) => r.error);
  const dot = $('status-dot');
  dot.className = 'status-dot';
  if (data.syncing) dot.classList.add('busy');
  else if (connected.length && (anyError || !last || now - Date.parse(last) > STALE_MS)) dot.classList.add('stale');
  else if (connected.length) dot.classList.add('ok');
  dot.title = data.syncing ? 'Syncing' : last ? `Last synced ${timeText(last)}` : 'Not synced yet';

  const rings = data.settings.view === 'rings';
  $('updated').textContent = mode === 'settings' || rings ? '' : last ? timeText(last) : '';
  $('btn-sync').classList.toggle('spinning', !!data.syncing);
  $('btn-pin').setAttribute('aria-pressed', String(data.settings.alwaysOnTop));
  $('btn-pin').title = data.settings.alwaysOnTop ? 'Always on top: on' : 'Always on top: off';
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

// ---------- Provider reordering ----------
// Rows follow the pointer with transforms only. On drop the DOM is reordered
// and every row glides from where it was drawn to its new slot (FLIP).
let drag = null;
let orderSaving = false;

// Runs `mutate` (a DOM reorder) and animates each row from its old spot.
function flip(box, mutate) {
  const rows = [...box.children];
  const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
  for (const r of rows) {
    r.classList.remove('shifting');
    r.style.transform = '';
  }
  mutate();
  for (const r of rows) {
    const d = before.get(r) - r.getBoundingClientRect().top;
    r.style.transform = d ? `translateY(${d}px)` : '';
  }
  void box.offsetHeight; // commit the starting positions before animating
  for (const r of rows) {
    r.classList.add('shifting');
    r.style.transform = '';
  }
}

async function saveOrder(box) {
  const ids = [...box.children].map((r) => r.dataset.provider);
  // Show the new order right away; the saved snapshot follows.
  const rank = (id) => ids.indexOf(id);
  data.providers.sort((a, b) => rank(a.id) - rank(b.id));
  data.rows.sort((a, b) => rank(a.id) - rank(b.id));
  orderSaving = true;
  try {
    data = await window.api.saveOrder(ids);
  } finally {
    orderSaving = false;
  }
  render();
}

function startDrag(e, el) {
  if (e.button !== 0 || drag) return;
  e.preventDefault();
  const box = $('provider-settings');
  const rows = [...box.children];
  if (rows.length < 2) return;
  const scroller = $('settings');
  const from = rows.indexOf(el);
  drag = {
    el, box, rows, scroller, from, to: from,
    startY: e.clientY,
    startScroll: scroller.scrollTop,
    tops: rows.map((r) => r.offsetTop),
    heights: rows.map((r) => r.offsetHeight),
  };
  // Follow the pointer on the window, so the drop lands wherever it is released.
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  document.body.classList.add('reordering');
  el.classList.remove('shifting');
  el.classList.add('lifted');
  for (const r of rows) if (r !== el) r.classList.add('shifting');
}

function moveDrag(e) {
  if (!drag) return;
  const { el, rows, from, tops, heights } = drag;
  const last = rows.length - 1;
  const raw = e.clientY - drag.startY + drag.scroller.scrollTop - drag.startScroll;
  // Keep the lifted row inside the list.
  const dy = Math.max(tops[0] - tops[from], Math.min(raw, tops[last] + heights[last] - tops[from] - heights[from]));
  el.style.transform = `translateY(${dy}px)`;

  // Its new slot: a row makes way once the lifted row's leading edge crosses
  // that row's midpoint.
  const top = tops[from] + dy;
  const bottom = top + heights[from];
  let to = from;
  rows.forEach((r, i) => {
    const mid = tops[i] + heights[i] / 2;
    if (i > from && bottom > mid) to++;
    if (i < from && top < mid) to--;
  });
  if (to === drag.to) return;
  drag.to = to;
  rows.forEach((r, i) => {
    if (i === from) return;
    let shift = 0;
    if (from < to && i > from && i <= to) shift = -heights[from];
    if (to < from && i >= to && i < from) shift = heights[from];
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function endDrag() {
  if (!drag) return;
  const { el, box, rows, from, to } = drag;
  drag = null;
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
  window.removeEventListener('blur', endDrag);
  document.body.classList.remove('reordering');
  el.classList.remove('lifted');
  flip(box, () => {
    if (to === from) return;
    const others = rows.filter((r) => r !== el);
    box.insertBefore(el, others[to] || null);
  });
  if (to !== from) saveOrder(box);
}

// Arrow keys move the focused row one place. The neighbour is the node that
// moves in the DOM, so the focused grip never loses focus.
function keyMove(e, el) {
  const up = e.key === 'ArrowUp';
  if (!up && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const box = el.parentElement;
  const other = up ? el.previousElementSibling : el.nextElementSibling;
  if (!other) return;
  flip(box, () => (up ? box.insertBefore(other, el.nextSibling) : box.insertBefore(other, el)));
  saveOrder(box);
}

// Provider rows in settings are built once and then updated in place, so a
// select or switch keeps focus while syncs come in.
function renderProviderSettings() {
  const box = $('provider-settings');
  for (const p of data.providers) {
    let el = box.querySelector(`[data-provider="${p.id}"]`);
    if (!el) {
      el = clone('tpl-provider-setting');
      el.dataset.provider = p.id;
      const grip = el.querySelector('.grip');
      grip.setAttribute('aria-label', `Move ${p.name} (arrow keys)`);
      grip.addEventListener('pointerdown', (e) => startDrag(e, el));
      grip.addEventListener('keydown', (e) => keyMove(e, el));
      setLogo(el.querySelector('.logo'), p);
      el.querySelector('.account-name').textContent = p.name;
      const select = el.querySelector('.plan-select');
      for (const o of p.plans) select.append(new Option(o.label, o.key));
      select.addEventListener('change', async () => {
        data = await window.api.saveProvider(p.id, { plan: select.value });
        render();
      });
      el.querySelector('.show-toggle').addEventListener('change', async (e) => {
        data = await window.api.saveProvider(p.id, { enabled: e.target.checked });
        render();
      });
      el.querySelector('.account-btn').addEventListener('click', async () => {
        const cur = data.providers.find((x) => x.id === p.id);
        if (cur.connected) {
          data = await window.api.signOut(p.id);
          render();
        } else {
          window.api.signIn(p.id);
        }
      });
      box.append(el);
    }
    el.classList.toggle('off', !p.enabled);
    el.querySelector('.show-toggle').checked = p.enabled;
    const select = el.querySelector('.plan-select');
    if (document.activeElement !== select) select.value = p.plan;
    const status = el.querySelector('.account-status');
    status.textContent = !p.enabled ? 'Hidden'
      : p.connected ? (p.lastSync ? `Connected · synced ${timeText(p.lastSync)}` : 'Connected')
        : 'Not signed in';
    status.classList.toggle('ok', p.enabled && p.connected);
    const btn = el.querySelector('.account-btn');
    btn.textContent = p.connected ? 'Sign out' : 'Sign in';
    btn.classList.toggle('primary', !p.connected);
  }
  // Match the saved order, unless a drag or save is mid-flight. Rows only move
  // when out of place, so a focused control isn't pulled out of the page.
  if (drag || orderSaving) return;
  data.providers.forEach((p, i) => {
    const el = box.querySelector(`[data-provider="${p.id}"]`);
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
}

function renderSettings() {
  renderProviderSettings();
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
  let ringCount = 0;
  if (mode === 'settings') renderSettings();
  else if (rings) ringCount = renderRings(now);
  else renderBars(now);
  fit(ringCount);
}

// Sizes the window to its content so the widget never shows empty space.
let fitFrame = 0;
function fit(ringCount) {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const view = mode === 'settings' ? $('settings') : data.settings.view === 'rings' ? $('rings') : $('bars');
    const inner = view.querySelector('.inner');
    const chrome = document.querySelector('.titlebar').offsetHeight + 2; // + body border
    const height = chrome + inner.offsetHeight;
    // Rings need room for the title-bar buttons even with one ring.
    const width = mode === 'widget' && data.settings.view === 'rings' ? Math.max(200, ringCount * RING_WIDTH + 26) : undefined;
    window.api.fit(mode, mode === 'settings' ? Math.min(height, 640) : height, width);
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
