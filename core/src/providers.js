// What each provider tracks, the plans people can pick, and which limits a plan
// shows. "Auto" shows every limit the account reports; picking a plan narrows
// the widget to that plan's limits (e.g. Claude Max 20x shows only weekly).
// Pure data and functions, shared by every platform and the tests.

// Shared with the Android app, which reads the same file from its assets.
const CATALOG = require('./catalog.json');

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
