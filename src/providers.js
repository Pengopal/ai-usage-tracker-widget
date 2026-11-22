// What each provider tracks, the plans people can pick, and which limits a plan
// shows. "Auto" shows every limit the account reports; picking a plan narrows
// the widget to that plan's limits (e.g. Claude Max 20x shows only weekly).
// Pure data and functions, shared by the main process and the tests.

const CATALOG = {
  claude: {
    name: 'Claude',
    logo: 'i-claude',
    url: 'https://claude.ai/settings/usage',
    metrics: { session: '5-hour', weekly: 'Weekly' },
    plans: {
      free: { label: 'Free', metrics: ['session', 'weekly'] },
      pro: { label: 'Pro', metrics: ['session', 'weekly'] },
      max: { label: 'Max', metrics: ['session', 'weekly'], hidden: true }, // detected, multiplier unknown
      max5: { label: 'Max 5x', metrics: ['session', 'weekly'] },
      max20: { label: 'Max 20x', metrics: ['weekly'] },
      team: { label: 'Team', metrics: ['session', 'weekly'] },
      enterprise: { label: 'Enterprise', metrics: ['session', 'weekly'] },
    },
  },
  openai: {
    name: 'ChatGPT',
    logo: 'i-openai',
    url: 'https://chatgpt.com/',
    metrics: { session: '5-hour', weekly: 'Weekly' },
    plans: {
      free: { label: 'Free', metrics: ['session', 'weekly'] },
      plus: { label: 'Plus', metrics: ['session', 'weekly'] },
      pro: { label: 'Pro', metrics: ['session', 'weekly'] },
      business: { label: 'Business', metrics: ['session', 'weekly'] },
      enterprise: { label: 'Enterprise', metrics: ['session', 'weekly'] },
    },
  },
  grok: {
    name: 'Grok',
    logo: 'i-xai',
    url: 'https://grok.com/',
    metrics: { weekly: 'Weekly' },
    plans: {
      free: { label: 'Free', metrics: ['weekly'] },
      supergrok: { label: 'SuperGrok', metrics: ['weekly'] },
      heavy: { label: 'SuperGrok Heavy', metrics: ['weekly'] },
      xpremium: { label: 'X Premium', metrics: ['weekly'] },
      xpremiumplus: { label: 'X Premium+', metrics: ['weekly'] },
    },
  },
};

const PROVIDER_IDS = Object.keys(CATALOG);

const emptyService = () => ({ connected: false, windows: {}, plan: null, detail: null, lastSync: null, error: null });

function defaultProviderSettings() {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, { enabled: true, plan: 'auto' }]));
}

// Plan choices for the settings picker.
function planOptions(id) {
  return [
    { key: 'auto', label: 'Auto-detect' },
    ...Object.entries(CATALOG[id].plans).filter(([, p]) => !p.hidden).map(([key, p]) => ({ key, label: p.label })),
  ];
}

// The plan in effect and the metrics it shows.
function effectivePlan(id, service, chosen) {
  const def = CATALOG[id];
  if (chosen && chosen !== 'auto' && def.plans[chosen]) {
    return { key: chosen, label: def.plans[chosen].label, metrics: def.plans[chosen].metrics };
  }
  const detected = service && service.plan && def.plans[service.plan] ? service.plan : null;
  return {
    key: 'auto',
    label: detected ? def.plans[detected].label : null,
    metrics: Object.keys(def.metrics),
  };
}

// The user's provider order: known ids once each, any missing ones appended.
function orderedIds(order) {
  const picked = (Array.isArray(order) ? order : []).filter((id, i, all) => CATALOG[id] && all.indexOf(id) === i);
  return [...picked, ...PROVIDER_IDS.filter((id) => !picked.includes(id))];
}

// Rows for the widget, in the user's order: enabled providers, each with the
// metrics its plan shows and the account actually reports.
function buildRows(services, providerSettings, insights = {}, order) {
  return orderedIds(order)
    .filter((id) => providerSettings[id]?.enabled !== false)
    .map((id) => {
      const def = CATALOG[id];
      const s = services[id] || emptyService();
      const plan = effectivePlan(id, s, providerSettings[id]?.plan);
      const metrics = plan.metrics
        .filter((m) => s.windows && s.windows[m])
        .map((m) => {
          const metricId = `${id}.${m}`;
          return {
            id: metricId,
            label: def.metrics[m],
            pct: s.windows[m].pct,
            reset: s.windows[m].reset,
            pace: insights.pace?.[metricId] ?? null,
            detail: m === 'weekly' && s.detail ? s.detail : null,
          };
        });
      return {
        id,
        name: def.name,
        logo: def.logo,
        plan: plan.label,
        connected: s.connected,
        error: s.error,
        lastSync: s.lastSync,
        metrics,
      };
    });
}

module.exports = { CATALOG, PROVIDER_IDS, emptyService, defaultProviderSettings, planOptions, effectivePlan, orderedIds, buildRows };
