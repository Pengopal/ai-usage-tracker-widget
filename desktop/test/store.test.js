const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, cleanThresholds } = require('../src/store');

test('v1.1 data files are migrated to the provider layout', () => {
  const d = normalize({
    claude: { connected: true, plan: 'claude_pro', session: { pct: 14, reset: 'a' }, weekly: { pct: 24, reset: 'b' }, lastSync: 'x' },
    grok: { connected: true, pct: 43, reset: 'c', total: null },
    settings: { view: 'rings', thresholds: [90, 75] },
  });
  assert.deepEqual(d.services.claude.windows, { session: { pct: 14, reset: 'a' }, weekly: { pct: 24, reset: 'b' } });
  assert.equal(d.services.claude.plan, 'pro');
  assert.deepEqual(d.services.grok.windows, { weekly: { pct: 43, reset: 'c' } });
  assert.equal(d.services.openai.connected, false);
  assert.equal(d.settings.view, 'rings');
  assert.deepEqual(d.settings.thresholds, [75, 90]);
  assert.deepEqual(d.settings.providers.openai, { enabled: true, plan: 'auto' });
});

test('thresholds are cleaned, deduplicated and sorted', () => {
  assert.deepEqual(cleanThresholds([100, '90', 90, -5, 'x', 150, 75]), [75, 90, 100]);
});
