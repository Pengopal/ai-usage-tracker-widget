// Turns each site's raw usage response into the widget's common shape:
//   { windows: { session?: { pct, reset }, weekly?: { pct, reset } }, plan?, detail? }
// Pure functions, no Electron, so they are unit-tested directly.

const pct = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Math.round(Number(v) * 10) / 10)) : 0);

const finite = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------- Claude ----------

// Plan key from the organisation's capabilities and rate-limit tier.
function claudePlan(org) {
  const caps = (org && org.capabilities) || [];
  const tier = String((org && (org.rate_limit_tier || org.rateLimitTier)) || '');
  if (/max_20x/i.test(tier)) return 'max20';
  if (/max_5x/i.test(tier)) return 'max5';
  if (caps.includes('claude_max')) return 'max';
  if (caps.includes('claude_pro')) return 'pro';
  if (/team/i.test(tier) || caps.includes('raven')) return 'team';
  return caps.length ? 'free' : null;
}

function parseClaude(res) {
  const u = res.usage || {};
  const win = (w) => (w && w.utilization != null ? { pct: pct(w.utilization), reset: w.resets_at || null } : null);
  return {
    windows: { session: win(u.five_hour), weekly: win(u.seven_day) },
    plan: claudePlan(res.org),
  };
}

// ---------- ChatGPT / OpenAI ----------

// The usage endpoint behind ChatGPT's and Codex's limit display reports a short
// window and a weekly window; they are told apart by their length.
function openaiWindow(w, now) {
  if (!w || typeof w !== 'object') return null;
  const used = finite(w.used_percent ?? w.usedPercent);
  if (used == null) return null;
  let reset = null;
  const at = finite(w.reset_at ?? w.resetAt ?? w.resetsAt);
  const after = finite(w.reset_after_seconds ?? w.resetAfterSeconds);
  if (at) reset = new Date(at * (at < 1e12 ? 1000 : 1)).toISOString();
  else if (after != null) reset = new Date(now + after * 1000).toISOString();
  const seconds = finite(w.limit_window_seconds ?? (w.windowDurationMins ?? w.window_minutes) * 60);
  return { pct: pct(used), reset, seconds };
}

const OPENAI_PLANS = { free: 'free', plus: 'plus', pro: 'pro', team: 'business', business: 'business', enterprise: 'enterprise', edu: 'enterprise' };

function parseOpenAI(res, now = Date.now()) {
  const body = res.usage || {};
  const limits = body.rate_limit || body.rateLimit || body;
  const windows = {};
  for (const w of [limits.primary_window, limits.secondary_window, limits.primary, limits.secondary]) {
    const parsed = openaiWindow(w, now);
    if (!parsed) continue;
    // Up to ~a day is the short session window; longer is the weekly one.
    const slot = parsed.seconds && parsed.seconds > 26 * 3600 ? 'weekly' : 'session';
    if (!windows[slot]) windows[slot] = { pct: parsed.pct, reset: parsed.reset };
  }
  const rawPlan = String(body.plan_type || res.plan || '').toLowerCase();
  return { windows, plan: OPENAI_PLANS[rawPlan] || null };
}

// ---------- Grok ----------

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
  const type = String((period && (period.type || period.periodType || period.period_type)) || '');
  if (used == null && finite(l.remainingPercent) != null) used = 100 - finite(l.remainingPercent);
  if (used == null) {
    const limit = amount(l.monthlyLimit ?? l.monthly_limit);
    const spent = amount(l.used);
    if (limit > 0 && spent != null) used = (spent / limit) * 100;
    else if (end || type === '1' || type === '2' || /WEEKLY|MONTHLY/i.test(type)) used = 0;
  }
  if (used == null) return null;
  const endMs = end ? Date.parse(end) : NaN;
  return { pct: pct(used), reset: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null };
}

function parseGrok(res, now = Date.now()) {
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
    const weekly = creditsWindow(l);
    return weekly ? { windows: { weekly } } : { error: 'Unrecognised usage response' };
  }
  const used = Math.max(0, total - Math.max(0, remaining));
  // When the pool is empty Grok reports how long until capacity frees up.
  const wait = Number(l.waitTimeSeconds);
  const reset = wait > 0 ? new Date(now + wait * 1000).toISOString() : null;
  return {
    windows: { weekly: { pct: pct((used / total) * 100), reset } },
    detail: { remaining, total, unit },
  };
}

module.exports = { parseClaude, parseOpenAI, parseGrok, claudePlan };
