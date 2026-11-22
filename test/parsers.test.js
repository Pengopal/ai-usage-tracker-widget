const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClaude, parseOpenAI, parseGrok } = require('../src/parsers');

const NOW = Date.parse('2026-11-22T12:00:00Z');

test('Claude: both windows and the plan from the rate-limit tier', () => {
  const r = parseClaude({
    org: { capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_20x' },
    usage: {
      five_hour: { utilization: 14, resets_at: '2026-11-22T16:29:00Z' },
      seven_day: { utilization: 24.04, resets_at: '2026-11-25T13:00:00Z' },
    },
  });
  assert.deepEqual(r.windows.session, { pct: 14, reset: '2026-11-22T16:29:00Z' });
  assert.equal(r.windows.weekly.pct, 24);
  assert.equal(r.plan, 'max20');
});

test('Claude: a window the account does not have is null', () => {
  const r = parseClaude({ org: { capabilities: ['claude_pro'] }, usage: { five_hour: null, seven_day: { utilization: 5 } } });
  assert.equal(r.windows.session, null);
  assert.equal(r.windows.weekly.pct, 5);
  assert.equal(r.plan, 'pro');
});

test('ChatGPT: windows are told apart by length, resets from seconds-after', () => {
  const r = parseOpenAI({
    usage: {
      plan_type: 'plus',
      rate_limit: {
        primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_after_seconds: 3600 },
        secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: 1764158400 },
      },
    },
  }, NOW);
  assert.deepEqual(r.windows.session, { pct: 37, reset: new Date(NOW + 3600e3).toISOString() });
  assert.deepEqual(r.windows.weekly, { pct: 12, reset: new Date(1764158400e3).toISOString() });
  assert.equal(r.plan, 'plus');
});

test('ChatGPT: missing windows give no limits rather than zeros', () => {
  const r = parseOpenAI({ usage: { plan_type: 'free', rate_limit: null } }, NOW);
  assert.deepEqual(r.windows, {});
  assert.equal(r.plan, 'free');
});

test('Grok: weekly credits pool, omitted percent on a known period is 0%', () => {
  const r = parseGrok({ limits: { config: { currentPeriod: { type: 'WEEKLY', end: '2026-11-28T00:00:00Z' } } } }, NOW);
  assert.deepEqual(r.windows.weekly, { pct: 0, reset: '2026-11-28T00:00:00.000Z' });
});

test('Grok: legacy rolling query window reports what is left', () => {
  const r = parseGrok({ limits: { totalQueries: 30, remainingQueries: 3, windowSizeSeconds: 7200 } }, NOW);
  assert.equal(r.windows.weekly.pct, 90);
  assert.deepEqual(r.detail, { remaining: 3, total: 30, unit: 'queries' });
});
