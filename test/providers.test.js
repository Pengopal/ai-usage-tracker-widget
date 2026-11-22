const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRows, defaultProviderSettings, planOptions, orderedIds } = require('../src/providers');

const services = {
  claude: { connected: true, plan: 'max20', windows: { session: { pct: 10, reset: null }, weekly: { pct: 40, reset: null } } },
  openai: { connected: false, windows: {} },
  grok: { connected: true, windows: { weekly: { pct: 43, reset: null } } },
};

test('auto plan shows every limit the account reports, labelled with the detected plan', () => {
  const rows = buildRows(services, defaultProviderSettings());
  const claude = rows.find((r) => r.id === 'claude');
  assert.equal(claude.plan, 'Max 20x');
  assert.deepEqual(claude.metrics.map((m) => m.id), ['claude.session', 'claude.weekly']);
});

test('choosing Claude Max 20x shows only the weekly limit', () => {
  const settings = { ...defaultProviderSettings(), claude: { enabled: true, plan: 'max20' } };
  const claude = buildRows(services, settings).find((r) => r.id === 'claude');
  assert.deepEqual(claude.metrics.map((m) => m.label), ['Weekly']);
});

test('hidden providers are left out of the widget', () => {
  const settings = { ...defaultProviderSettings(), grok: { enabled: false, plan: 'auto' } };
  assert.deepEqual(buildRows(services, settings).map((r) => r.id), ['claude', 'openai']);
});

test('a signed-out provider still gets a row so it can be signed in', () => {
  const openai = buildRows(services, defaultProviderSettings()).find((r) => r.id === 'openai');
  assert.equal(openai.connected, false);
  assert.deepEqual(openai.metrics, []);
});

test('rows follow the chosen provider order', () => {
  const rows = buildRows(services, defaultProviderSettings(), {}, ['grok', 'claude', 'openai']);
  assert.deepEqual(rows.map((r) => r.id), ['grok', 'claude', 'openai']);
});

test('an order missing providers or naming unknown ones still lists each provider once', () => {
  assert.deepEqual(orderedIds(['grok', 'gemini', 'grok']), ['grok', 'claude', 'openai']);
  assert.deepEqual(orderedIds(undefined), ['claude', 'openai', 'grok']);
});

test('the plan picker offers Auto first and no internal-only plans', () => {
  const keys = planOptions('claude').map((o) => o.key);
  assert.equal(keys[0], 'auto');
  assert.ok(keys.includes('max20'));
  assert.ok(!keys.includes('max'));
});
