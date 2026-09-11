const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../build.cjs');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'family-build-sync-'));
}

test('static build injects Google OAuth client ID and includes cloud sync code', async () => {
  const output = await tempDir();
  const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-test.apps.googleusercontent.com';
  try {
    await build(output);
    const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /meta name="family-storage-mode" content="browser"/);
    assert.match(html, /meta name="google-oauth-client-id" content="123456789-test\.apps\.googleusercontent\.com"/);
    assert.match(html, /assets\/google-drive-sync\.js/);
    const syncJs = await fs.readFile(path.join(output, 'assets', 'google-drive-sync.js'), 'utf8');
    assert.match(syncJs, /sessionStorage\.setItem\(tokenStorageKey/);
    assert.match(syncJs, /function restoreStoredToken\(\)/);
    assert.match(syncJs, /clearStoredToken\(\)/);
    await assert.rejects(fs.access(path.join(output, 'data', 'family.json')));
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
    await fs.rm(output, { recursive: true, force: true });
  }
});

test('static build remains local-only when OAuth client ID is omitted', async () => {
  const output = await tempDir();
  const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  try {
    await build(output);
    const html = await fs.readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /meta name="google-oauth-client-id" content=""/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
    await fs.rm(output, { recursive: true, force: true });
  }
});

test('static build rejects malformed OAuth client IDs', async () => {
  const output = await tempDir();
  const previous = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = '<script>alert(1)</script>';
  try {
    await assert.rejects(() => build(output), /GOOGLE_OAUTH_CLIENT_ID 格式不正確/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previous;
    await fs.rm(output, { recursive: true, force: true });
  }
});
