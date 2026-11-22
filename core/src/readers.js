// Reader functions that run inside the provider's own page, so their requests
// carry the site's cookies exactly like the official usage pages do. Desktop
// runs them with executeJavaScript(`(${fn})(arg)`); Android loads this file
// into a WebView on the provider's origin. Each must stay self-contained: no
// references to anything outside its own body.
//
// They return { auth: false } when signed out, { auth: true, error } on a
// problem, or { auth: true, ...raw } for interpret() to parse. Tokens and
// cookies are never part of the result.
//
// These are the sites' internal endpoints, not public APIs; they can change.

// claude.ai: organisations, then the usage of the one carrying the chat plan.
async function claude() {
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
}

// chatgpt.com: the session endpoint hands the page a short-lived access token;
// the usage call needs it as a bearer token. The token never leaves this page.
async function openai() {
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
}

// grok.com: the usage page reads GET /rest/grok/credits (weekly pool, reset,
// used %). POST /rest/rate-limits is the old rolling query window, a fallback.
async function grok(model) {
  const modelName = model || '';
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
}

module.exports = { claude, openai, grok };
