// Run with node tests/browser-device-reset.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { build } = require('../dev/build.cjs');
const { mimeTypeFor } = require('../dev/site-source.cjs');
const clientId = '123456789-test.apps.googleusercontent.com';
const data = { schemaVersion: 2, familyName: '保留的雲端族譜', people: [
  { id: 'G', name: '雲端成員', gender: 'U', location: '', position: '', siblingOrder: null, relationships: [] }
] };

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-device-reset-'));
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
    const base = `http://127.0.0.1:${server.address().port}/repo/`;
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      context.setDefaultTimeout(10_000);
      const errors = [], cloudRequests = [];
      let holdCloud = false;
      await context.route('https://www.googleapis.com/**', route => {
        cloudRequests.push({ method: route.request().method(), url: route.request().url() });
        if (holdCloud) return;
        const body = route.request().url().includes('alt=media') ? data : { files: [{ id: 'cloud-family', version: '1' }] };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.addInitScript(() => {
        window.__failReads = false;
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          if (args[1] === 'readonly' && window.__failReads) throw new DOMException('Internal error.', 'UnknownError');
          return transaction.apply(this, args);
        };
        window.google = { accounts: { oauth2: { initTokenClient: config => {
          window.__tokenConfig = config;
          return { requestAccessToken() { config.callback({ access_token: 'test-token', expires_in: 3600 }); } };
        } } } };
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.snapshot?.());
      assert.equal(await page.locator('#cloud-sync-reset-section').isVisible(), false);
      await page.evaluate(data => FamilyApp.importFamily({ data, version: FamilyApp.snapshot().version }), data);
      await page.evaluate(async () => {
        await FamilyRepository.setSyncState({ connected: true, dirty: true });
        await FamilyRepository.setLocationCache('reset-test', { cached: true });
      });
      await page.waitForFunction(() => window.__tokenConfig);
      await page.evaluate(() => window.__tokenConfig.callback({ access_token: 'old-token', expires_in: 3600 }));
      const saved = await page.evaluate(() => FamilyRepository.read());
      const other = await context.newPage();
      other.on('pageerror', error => errors.push(error.message));
      await other.goto(base);
      await other.waitForFunction(() => FamilyApp?.graph?.()?.people.length === 1);
      await other.evaluate(() => sessionStorage.setItem('family-tree-google-drive-token-v1', JSON.stringify({ accessToken: 'other-old-token', tokenExpiresAt: Date.now() + 3600000, clientId: document.querySelector('meta[name="google-oauth-client-id"]').content, scope: 'https://www.googleapis.com/auth/drive.appdata' })));
      await page.evaluate(saved => {
        localStorage.setItem('family-static-v1:/repo/', JSON.stringify(saved));
        localStorage.setItem('family-static-v1:/repo/:before-import', JSON.stringify(saved));
        localStorage.setItem('family-tree:recent-members:v1:/repo/', '["G"]');
        localStorage.setItem('unrelated:keep', 'preserved');
        sessionStorage.setItem('family-tree:member-form-draft:v1', 'draft');
        sessionStorage.setItem('family-tree:canvas-view:v1:/repo/', 'view');
      }, saved);
      // Another site's database on this origin must remain intact.
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('family-tree-v2:/other/', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').put('preserved', 'sentinel');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }));
      const openCloud = async () => {
        await page.bringToFront();
        await page.locator(width === 390 ? '#portrait-more-open' : '#desktop-more-open').click();
        await page.locator('[data-action="cloud"]').click();
        await page.waitForFunction(() => document.getElementById('cloud-sync-dialog').open);
      };
      await page.evaluate(() => { window.__failReads = true; });
      await openCloud();
      assert.equal(await page.locator('#cloud-sync-reset-device').isVisible(), true);
      await page.locator('#cloud-sync-reset-device').click();
      assert.match(await page.locator('#cloud-reset-device-description').textContent(), /未同步變更.*無法復原/);
      assert(await page.locator('#cloud-reset-device-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
      if (process.env.DEVICE_RESET_SCREENSHOTS) {
        await page.waitForFunction(() => getComputedStyle(document.getElementById('cloud-reset-device-dialog')).opacity === '1');
        await page.screenshot({ path: path.join(process.env.DEVICE_RESET_SCREENSHOTS, `device-reset-${width}.png`) });
      }
      await page.locator('#cloud-reset-device-cancel').click();
      await page.evaluate(() => { window.__failReads = false; });
      assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), saved);
      assert(await page.evaluate(() => sessionStorage.getItem('family-tree-google-drive-token-v1')));
      await page.locator('#close-cloud-sync-dialog').click();

      // Failed deletion reports an error and can be retried without a read.
      await page.evaluate(() => {
        window.__failReads = true;
        window.__deleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
        indexedDB.deleteDatabase = () => { throw new DOMException('Internal error.', 'UnknownError'); };
      });
      await openCloud();
      await page.locator('#cloud-sync-reset-device').click();
      await page.locator('#cloud-reset-device-confirm').click();
      await page.waitForFunction(() => document.getElementById('cloud-reset-device-error').textContent.includes('重置未完成'));
      assert.equal(await page.locator('#cloud-reset-device-confirm').isEnabled(), true);
      await page.evaluate(() => { window.__failReads = false; indexedDB.deleteDatabase = window.__deleteDatabase; });
      assert.deepEqual(await page.evaluate(() => FamilyRepository.read()), saved);

      // Deliberately retain an older tab's connection to exercise blocked deletion.
      await page.evaluate(() => new Promise(resolve => {
        const request = indexedDB.open('family-tree-v2:/repo/', 1);
        request.onsuccess = () => { window.__blocker = request.result; window.__blocker.onversionchange = () => {}; resolve(); };
      }));
      holdCloud = true;
      const beforeReset = cloudRequests.length;
      await page.evaluate(() => { window.__failReads = true; });
      const reloaded = page.waitForEvent('load');
      await page.locator('#cloud-reset-device-confirm').click();
      await page.waitForFunction(() => document.getElementById('cloud-reset-device-status').textContent.includes('其他族譜分頁'));
      assert.equal(await page.locator('#cloud-reset-device-confirm').isDisabled(), true);
      assert.equal(await page.locator('#cloud-reset-device-cancel').isDisabled(), true);
      await page.evaluate(() => window.__blocker.close());
      await reloaded;
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.length === 0);
      await other.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.length === 0);
      assert.equal(cloudRequests.length, beforeReset, 'reset and reload must not request Google Drive');
      for (const tab of [page, other]) {
        assert.equal(await tab.evaluate(() => sessionStorage.getItem('family-tree-google-drive-token-v1')), null);
        assert.equal((await tab.evaluate(() => FamilyRepository.getSyncState())).connected, false);
      }
      assert.deepEqual(await page.evaluate(() => [
        localStorage.getItem('family-static-v1:/repo/'), localStorage.getItem('family-static-v1:/repo/:before-import'),
        localStorage.getItem('family-tree:recent-members:v1:/repo/'), sessionStorage.getItem('family-tree:member-form-draft:v1')
      ]), [null, null, null, null]);
      assert.notEqual(await page.evaluate(() => sessionStorage.getItem('family-tree:canvas-view:v1:/repo/')), 'view');
      assert.equal(await page.evaluate(() => localStorage.getItem('unrelated:keep')), 'preserved');
      assert.equal(await page.evaluate(() => FamilyRepository.getLocationCache('reset-test')), null);
      assert.equal(await page.evaluate(() => new Promise(resolve => {
        const request = indexedDB.open('family-tree-v2:/other/', 1);
        request.onsuccess = () => {
          const db = request.result, get = db.transaction('records', 'readonly').objectStore('records').get('sentinel');
          get.onsuccess = () => { db.close(); resolve(get.result); };
        };
      })), 'preserved');
      // A sleeping tab's old token must not reconnect after a reset.
      await page.evaluate(() => sessionStorage.setItem('family-tree-google-drive-token-v1', JSON.stringify({ accessToken: 'sleeping-old-token', tokenExpiresAt: Date.now() + 3600000, clientId: document.querySelector('meta[name="google-oauth-client-id"]').content, scope: 'https://www.googleapis.com/auth/drive.appdata' })));
      await page.reload();
      await page.waitForFunction(() => FamilyApp?.snapshot?.());
      assert.equal(await page.evaluate(() => sessionStorage.getItem('family-tree-google-drive-token-v1')), null);
      assert.equal(cloudRequests.length, beforeReset);

      // Explicitly reconnecting downloads the unchanged cloud version.
      holdCloud = false;
      await openCloud();
      await page.locator('#cloud-sync-action').click();
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.length === 1);
      assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data), data);
      assert(cloudRequests.every(request => request.method === 'GET'), 'no cloud create, update or delete is permitted');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: confirmed local-only reset, cancel/failure/blocked states, multiple tabs, stale tokens, scoped cleanup and explicit cloud download on desktop/mobile');
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
