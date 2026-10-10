// Run with node tests/browser-static-storage-errors.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { build } = require('../dev/build.cjs');
const { mimeTypeFor } = require('../dev/site-source.cjs');
const clientId = '123456789-test.apps.googleusercontent.com';

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-storage-errors-'));
  const previousClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = clientId;
  let browser, server;
  try {
    await build(dir);
    server = http.createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (!pathname.startsWith('/repo/')) throw new Error('Outside project');
        const file = path.join(dir, pathname.slice(6) || 'index.html');
        res.setHeader('Content-Type', mimeTypeFor(file));
        res.end(await fs.readFile(file));
      } catch { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.context().addInitScript(() => {
      window.__storageFailures = location.search.includes('fail-storage') ? 100 : 0;
      window.__storageAttempts = 0;
      window.__dbOpens = 0;
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        if (args[1] === 'readonly' && window.__storageFailures > 0) {
          window.__storageFailures--;
          window.__storageAttempts++;
          throw new DOMException('Internal error.', 'UnknownError');
        }
        return transaction.apply(this, args);
      };
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (...args) {
        const request = open.apply(this, args);
        window.__dbOpens++;
        request.addEventListener('success', () => { window.__db = request.result; });
        return request;
      };
      window.google = { accounts: { oauth2: { initTokenClient: config => {
        window.__tokenConfig = config;
        return { requestAccessToken() {} };
      } } } };
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/repo/');
    await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.getElementById('cloud-sync').dataset.syncState === 'disconnected');
    await page.locator('#add-member').click();
    await page.locator('#member-name').fill('保留的族譜成員');
    await page.locator('#save-member').click();
    await page.waitForFunction(() => FamilyApp.graph().people.length === 1);
    const original = await page.evaluate(() => FamilyRepository.read());

    // A persistent storage failure must leave a visible retry action, not reject
    // the cloud button event or assume that the stored family is empty.
    await page.evaluate(() => { window.__storageFailures = 100; });
    await page.locator('#cloud-sync').evaluate(node => node.click());
    await page.waitForTimeout(100);
    assert.deepEqual(errors, []);
    await page.waitForFunction(() => document.getElementById('cloud-sync-dialog').open, null, { timeout: 2500 });
    assert.match(await page.locator('#cloud-sync-message').textContent(), /無法讀取/);
    assert.equal(await page.locator('#cloud-sync-action').textContent(), '重試讀取同步狀態');
    assert.equal(await page.evaluate(() => window.__storageAttempts), 2, 'read retries are bounded');
    assert.deepEqual(errors, []);
    await page.locator('#close-cloud-sync-dialog').click();
    await page.evaluate(() => { window.__storageFailures = 0; });
    await page.locator('#cloud-sync').evaluate(node => node.click());
    await page.waitForFunction(() => document.getElementById('cloud-sync-action').textContent === '連結 Google Drive');
    assert.equal(await page.locator('#cloud-sync-action').textContent(), '連結 Google Drive');
    await page.locator('#close-cloud-sync-dialog').click();
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), original);

    // A one-off read failure reopens the same database without losing its data.
    const opens = await page.evaluate(() => window.__dbOpens);
    await page.evaluate(() => { window.__storageFailures = 1; });
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), original);
    assert.equal(await page.evaluate(() => window.__dbOpens), opens + 1);
    const beforeClose = await page.evaluate(() => window.__dbOpens);
    await page.evaluate(() => { window.__db.close(); window.__db.dispatchEvent(new Event('close')); });
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), original);
    assert.equal(await page.evaluate(() => window.__dbOpens), beforeClose + 1);

    // Metadata failures also need handling on the sync-state event and unlink.
    await page.evaluate(() => {
      window.__getSyncState = FamilyRepository.getSyncState;
      FamilyRepository.getSyncState = async () => { throw new DOMException('Internal error.', 'UnknownError'); };
      dispatchEvent(new CustomEvent('familyreposyncstate', { detail: { connected: true } }));
    });
    await page.waitForFunction(() => document.getElementById('cloud-sync').dataset.syncState === 'error');
    await page.evaluate(() => { FamilyRepository.getSyncState = window.__getSyncState; });
    await page.evaluate(() => FamilyRepository.setSyncState({ connected: true }));
    await page.locator('#cloud-sync').evaluate(node => node.click());
    await page.evaluate(() => {
      window.__setSyncState = FamilyRepository.setSyncState;
      FamilyRepository.setSyncState = async () => { throw new DOMException('Internal error.', 'UnknownError'); };
    });
    await page.locator('#cloud-sync-disconnect').click();
    await page.waitForFunction(() => document.getElementById('cloud-sync').dataset.syncState === 'error');
    await page.evaluate(() => { FamilyRepository.setSyncState = window.__setSyncState; });
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), original);
    await page.locator('#close-cloud-sync-dialog').click();

    // Sync errors must also resolve cleanly when a token already exists.
    const driveRequests = [];
    await page.route('https://www.googleapis.com/**', route => {
      driveRequests.push(route.request().method());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ files: [] }) });
    });
    await page.evaluate(() => {
      window.__tokenConfig.callback({ access_token: 'test-token', expires_in: 3600 });
      FamilyRepository.getSyncState = async () => { throw new DOMException('Internal error.', 'UnknownError'); };
    });
    const outcome = await page.evaluate(async () => (await FamilyGoogleDriveSync.syncNow({ interactive: false })).outcome);
    assert.equal(outcome, 'error');
    assert.deepEqual(errors, []);
    assert(!driveRequests.some(method => method !== 'GET'), 'failed local reads must not upload an empty family');
    await page.evaluate(() => { FamilyRepository.getSyncState = window.__getSyncState; });
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), original);

    // An initial read failure has an explicit recovery path and preserves the
    // saved member instead of keeping the app disabled indefinitely.
    const startup = await page.context().newPage();
    startup.on('pageerror', error => errors.push(error.message));
    await startup.goto(base + '/repo/?fail-storage');
    const retry = startup.getByRole('button', { name: '重試載入', exact: true });
    await retry.waitFor();
    assert.equal(await startup.evaluate(() => FamilyApp.snapshot()), null);
    assert.equal(await startup.locator('#add-member').isDisabled(), true);
    await startup.evaluate(() => { window.__storageFailures = 0; });
    await retry.click();
    await startup.waitForFunction(() => FamilyApp?.graph?.()?.people.length === 1);
    assert.deepEqual(await startup.evaluate(() => FamilyRepository.read()), original);
    assert.equal(await startup.locator('#add-member').isEnabled(), true);
    await startup.locator('#add-member').click();
    await startup.locator('#member-name').fill('恢復後新增');
    await startup.locator('#save-member').click();
    await startup.waitForFunction(() => FamilyApp.graph().people.length === 2);
    await startup.reload();
    await retry.waitFor();
    await startup.evaluate(() => { window.__storageFailures = 0; });
    await retry.click();
    await startup.waitForFunction(() => FamilyApp?.graph?.()?.people.length === 2);
    assert.deepEqual(errors, []);
    await startup.close();

    const iconUrl = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal(new URL(iconUrl, base + '/repo/').pathname, '/repo/assets/favicon.svg');
    const icon = await page.request.get(new URL(iconUrl, base + '/repo/').href);
    assert.equal(icon.status(), 200);
    assert.match(icon.headers()['content-type'], /^image\/svg\+xml/);
    assert(!requests.some(url => new URL(url).pathname === '/favicon.ico'));
    console.log('PASS: static subpath favicon, bounded IndexedDB recovery, cloud error/retry UI, closed connections, preserved family data');
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
