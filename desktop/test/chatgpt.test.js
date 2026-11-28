const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ChatGPT } = require('../src/chatgpt');

const authUrl = 'https://auth.openai.com/oauth/authorize?state=example';

function withServer(request, openBrowser) {
  const server = { request };
  const legacy = { signOut: async () => {}, readExistingLogin: async () => ({ connected: false }) };
  const client = new ChatGPT({ binary: 'codex', openBrowser, legacy });
  client.connect = async () => server;
  return { client, server };
}

test('browser sign-in uses the OpenAI URL and waits for its own callback', async () => {
  const { client, server } = withServer(async (method, params) => {
    assert.equal(method, 'account/login/start');
    assert.deepEqual(params, { type: 'chatgpt' });
    return { loginId: 'this-login', authUrl };
  }, async (url) => {
    assert.equal(url, authUrl);
    server.onLogin({ loginId: 'old-login', success: false });
    server.onLogin({ loginId: 'this-login', success: true });
  });
  let clearedLegacy = false;
  client.legacy.signOut = async () => { clearedLegacy = true; };
  assert.equal(await client.signIn(new AbortController().signal), true);
  assert.equal(clearedLegacy, true);
});

test('cancelling before the start reply releases the callback and skips opening the browser', async () => {
  const controller = new AbortController();
  const { client } = withServer(async (method, params) => {
    if (method === 'account/login/start') {
      controller.abort();
      return { loginId: 'this-login', authUrl };
    }
    assert.equal(method, 'account/login/cancel');
    assert.deepEqual(params, { loginId: 'this-login' });
  }, () => assert.fail('Opened the browser after cancellation'));
  assert.equal(await client.signIn(controller.signal), false);
});

test('a browser launch failure cancels that login and lets the user retry', async () => {
  const methods = [];
  const { client } = withServer(async (method) => {
    methods.push(method);
    if (method === 'account/login/start') return { loginId: 'this-login', authUrl };
  }, async () => { throw new Error('No browser'); });
  await assert.rejects(client.signIn(new AbortController().signal), /default browser/);
  assert.deepEqual(methods, ['account/login/start', 'account/login/cancel']);
});

test('reads Codex limits with separate five-hour and weekly windows', async () => {
  const codex = {
    primary: { usedPercent: 31, windowDurationMins: 300, resetsAt: 1800000000 },
    secondary: { usedPercent: 47, windowDurationMins: 10080, resetsAt: 1800500000 },
  };
  const { client } = withServer(async (method) => {
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    assert.equal(method, 'account/rateLimits/read');
    return { rateLimits: {}, rateLimitsByLimitId: { codex } };
  });
  assert.deepEqual(await client.read(), {
    connected: true,
    plan: 'plus',
    windows: {
      session: { pct: 31, reset: new Date(1800000000000).toISOString() },
      weekly: { pct: 47, reset: new Date(1800500000000).toISOString() },
    },
  });
});
