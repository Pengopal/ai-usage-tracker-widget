const test = require('node:test');
const assert = require('node:assert/strict');
const readers = require('../src/readers');
const catalog = require('../src/catalog.json');

test('there is a reader for every provider in the catalog', () => {
  assert.deepEqual(Object.keys(readers).sort(), Object.keys(catalog).sort());
});

// Readers run inside the provider's page (desktop: fn.toString(); Android: the
// core bundle in a WebView), so they must not reach outside their own body.
test('readers are self-contained async functions', () => {
  for (const [id, fn] of Object.entries(readers)) {
    const src = fn.toString();
    assert.match(src, /^async function/, id);
    assert.doesNotMatch(src, /require\(|module\.|exports\./, id);
  }
});

test('a reader turns a 401 into "signed out"', async () => {
  global.fetch = async () => ({ status: 401, json: async () => ({}) });
  try {
    assert.deepEqual(await readers.claude(), { auth: false });
    assert.deepEqual(await readers.openai(), { auth: false });
    assert.deepEqual(await readers.grok(''), { auth: false });
  } finally {
    delete global.fetch;
  }
});
