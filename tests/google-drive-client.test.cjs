const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/assets/google-drive-client.js');

test('stopping device sync aborts pending Drive requests', async () => {
  const savedFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    });
  };
  try {
    const client = Client.create({ getAccessToken: () => 'test-token' });
    const pending = client.find();
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requests.length, 1);
    client.cancelPending();
    await rejected;
    assert.equal(requests[0].signal.aborted, true);
  } finally { globalThis.fetch = savedFetch; }
});

test('a cancelled request cannot complete even if the transport ignores abort', async () => {
  const savedFetch = globalThis.fetch;
  let complete;
  globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
  try {
    const client = Client.create({ getAccessToken: () => 'test-token' });
    const rejected = assert.rejects(client.find(), { name: 'AbortError' });
    client.cancelPending();
    complete(new Response(JSON.stringify({ files: [{ id: 'stale-file' }] })));
    await rejected;
  } finally { globalThis.fetch = savedFetch; }
});
