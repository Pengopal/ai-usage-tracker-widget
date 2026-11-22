const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInsights, sampleOf, migrateSample } = require('../src/insights');

const MIN = 60e3;
const NOW = Date.parse('2026-11-22T12:00:00Z');

const services = (pct, reset) => ({ claude: { connected: true, windows: { session: { pct, reset } } } });

test('pace predicts run-out from the last hour of readings', () => {
  // 30 points in the last 60 minutes, now at 64% → 36 points left ≈ 72 minutes.
  const history = [60, 45, 30, 15, 0].map((ago) => ({ t: NOW - ago * MIN, v: { 'claude.session': 64 - ago * 0.5 } }));
  const { pace } = computeInsights(services(64, new Date(NOW + 3 * 3600e3).toISOString()), history, NOW);
  assert.ok(Math.abs(pace['claude.session'] - 72 * MIN) < MIN);
});

test('no pace warning when the reset comes before run-out', () => {
  const history = [60, 0].map((ago) => ({ t: NOW - ago * MIN, v: { 'claude.session': 64 - ago * 0.5 } }));
  const { pace } = computeInsights(services(64, new Date(NOW + 30 * MIN).toISOString()), history, NOW);
  assert.equal(pace['claude.session'], null);
});

test('a reset in the middle of the history starts the pace window fresh', () => {
  const history = [
    { t: NOW - 80 * MIN, v: { 'claude.session': 95 } },
    { t: NOW - 20 * MIN, v: { 'claude.session': 2 } },
    { t: NOW, v: { 'claude.session': 3 } },
  ];
  const { pace } = computeInsights(services(3, null), history, NOW);
  // 1 point in 20 minutes → 97 points ≈ 32 hours, but never measured across the reset.
  assert.ok(pace['claude.session'] > 30 * 60 * MIN);
});

test('samples record every reported window', () => {
  assert.deepEqual(sampleOf({ grok: { windows: { weekly: { pct: 43 } } } }, NOW), { t: NOW, v: { 'grok.weekly': 43 } });
});

test('v1.1 history samples are migrated', () => {
  assert.deepEqual(migrateSample({ t: 1, cs: 10, cw: 20, g: 30 }), { t: 1, v: { 'claude.session': 10, 'claude.weekly': 20, 'grok.weekly': 30 } });
});
