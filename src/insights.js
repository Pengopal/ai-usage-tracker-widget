// Burn-rate pace from the stored reading history, for the heads-up notification.
// History samples look like { t, v: { 'claude.session': 14, 'grok.weekly': 43, … } }.
const MINUTE = 60 * 1000;
const PACE_LOOKBACK = 90 * MINUTE;
const PACE_MIN_SPAN = 10 * MINUTE;

// Every metric with a reading: { 'claude.session': { pct, reset }, … }.
function currentReadings(services) {
  const out = {};
  for (const [id, s] of Object.entries(services || {})) {
    for (const [m, w] of Object.entries((s && s.windows) || {})) {
      if (w && w.pct != null) out[`${id}.${m}`] = w;
    }
  }
  return out;
}

const valueOf = (sample, key) => (sample.v ? sample.v[key] : undefined);

// Points since the most recent reset (a drop of more than a point), within the lookback.
function currentWindow(history, key, now) {
  const pts = history.filter((s) => valueOf(s, key) != null && now - s.t <= PACE_LOOKBACK);
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (valueOf(pts[i], key) < valueOf(pts[i - 1], key) - 1) start = i;
  }
  return pts.slice(start);
}

// Estimated ms until the limit hits 100% at the recent burn rate, or null when
// usage is flat, the sample span is too short, or the reset comes first.
function pace(history, key, current, now) {
  if (!current || current.pct == null || current.pct >= 100) return null;
  const pts = currentWindow(history, key, now);
  if (pts.length < 2) return null;
  const first = pts[0];
  const span = now - first.t;
  const gained = current.pct - valueOf(first, key);
  if (span < PACE_MIN_SPAN || gained <= 0.5) return null;
  const etaMs = ((100 - current.pct) / gained) * span;
  const resetMs = current.reset ? Date.parse(current.reset) - now : Infinity;
  if (!(etaMs < resetMs)) return null;
  return Math.round(etaMs);
}

function computeInsights(services, history, now = Date.now()) {
  const out = { pace: {} };
  for (const [key, current] of Object.entries(currentReadings(services))) {
    out.pace[key] = pace(history, key, current, now);
  }
  return out;
}

function sampleOf(services, now = Date.now()) {
  const v = {};
  for (const [key, w] of Object.entries(currentReadings(services))) v[key] = w.pct;
  return { t: now, v };
}

// v1.1 stored { t, cs, cw, g }.
function migrateSample(s) {
  if (!s || s.v) return s;
  const v = {};
  if (s.cs != null) v['claude.session'] = s.cs;
  if (s.cw != null) v['claude.weekly'] = s.cw;
  if (s.g != null) v['grok.weekly'] = s.g;
  return { t: s.t, v };
}

module.exports = { computeInsights, sampleOf, currentReadings, migrateSample, pace };
