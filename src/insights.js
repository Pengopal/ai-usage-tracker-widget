// Derived views over the stored reading history: burn-rate pace and sparklines.
const MINUTE = 60 * 1000;
const PACE_LOOKBACK = 90 * MINUTE;
const PACE_MIN_SPAN = 10 * MINUTE;
const SPARK_SPAN = 24 * 60 * MINUTE;

// Metric keys used in history samples.
const METRICS = {
  'claude.session': { key: 'cs', read: (d) => d.claude.session },
  'claude.weekly': { key: 'cw', read: (d) => d.claude.weekly },
  grok: { key: 'g', read: (d) => (d.grok.pct == null ? null : { pct: d.grok.pct, reset: d.grok.reset }) },
};

// Points since the most recent reset (a drop of more than a point), within the lookback.
function currentWindow(history, key, now) {
  const pts = history.filter((s) => s[key] != null && now - s.t <= PACE_LOOKBACK);
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][key] < pts[i - 1][key] - 1) start = i;
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
  const gained = current.pct - first[key];
  if (span < PACE_MIN_SPAN || gained <= 0.5) return null;
  const etaMs = ((100 - current.pct) / gained) * span;
  const resetMs = current.reset ? Date.parse(current.reset) - now : Infinity;
  if (!(etaMs < resetMs)) return null;
  return Math.round(etaMs);
}

function computeInsights(data, history, now = Date.now()) {
  const out = { pace: {}, spark: {} };
  for (const [id, m] of Object.entries(METRICS)) {
    const current = m.read(data);
    out.pace[id] = pace(history, m.key, current, now);
    out.spark[id] = history
      .filter((s) => s[m.key] != null && now - s.t <= SPARK_SPAN)
      .map((s) => [s.t, s[m.key]]);
  }
  return out;
}

function sampleOf(data, now = Date.now()) {
  const s = { t: now };
  for (const m of Object.values(METRICS)) {
    const cur = m.read(data);
    s[m.key] = cur && cur.pct != null ? cur.pct : null;
  }
  return s;
}

module.exports = { METRICS, computeInsights, sampleOf, pace };
