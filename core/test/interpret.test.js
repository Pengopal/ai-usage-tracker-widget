const test = require('node:test');
const assert = require('node:assert/strict');
const { interpret } = require('../src/interpret');

test('a signed-out reader result is just "not connected"', () => {
  assert.deepEqual(interpret('claude', { auth: false }), { connected: false });
});

test('a reader error keeps the session connected and passes the message on', () => {
  assert.deepEqual(interpret('grok', { auth: true, error: 'x' }), { connected: true, error: 'x' });
});

test('a missing or malformed result counts as signed out, not a crash', () => {
  assert.deepEqual(interpret('openai', null), { connected: false });
  assert.deepEqual(interpret('openai', 'nope'), { connected: false });
});

test('Claude usage becomes session and weekly windows with the plan', () => {
  const res = {
    auth: true,
    org: { capabilities: ['chat', 'claude_pro'] },
    usage: { five_hour: { utilization: 14, resets_at: '2026-01-01T00:00:00Z' }, seven_day: { utilization: 40.04, resets_at: null } },
  };
  const out = interpret('claude', res, 0);
  assert.equal(out.connected, true);
  assert.equal(out.windows.session.pct, 14);
  assert.equal(out.windows.weekly.pct, 40);
  assert.equal(out.plan, 'pro');
});

test('an unknown provider id is reported as an error', () => {
  assert.deepEqual(interpret('gemini', { auth: true }), { connected: true, error: 'Unknown provider gemini' });
});
