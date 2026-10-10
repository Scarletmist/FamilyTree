// Run with node tests/browser-grandparents.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const Model = require('../src/assets/family-model.js');
const person = (id, relationships = []) => ({ id, name: id, gender: 'U', location: '', position: '', siblingOrder: null, relationships });
const grandparent = personId => ({ type: 'grandparent', personId, kind: '親生' });
const initial = { schemaVersion: 2, people: [person('G'), person('C', [grandparent('G')])] };

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-grandparents-'));
  const dataFile = path.join(dir, 'family.json');
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const mode of ['api', 'static']) for (const width of [1280, 390]) {
      await fs.writeFile(dataFile, JSON.stringify(initial));
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({ browserStorage: true });
        await page.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.addInitScript(data => localStorage.setItem('family-static-v1:/', JSON.stringify({ data, version: 'initial' })), initial);
      }
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.graph?.()?.people.length === 2 && document.querySelector('.intermediate-node'));
      assert.equal(await page.locator('#tree-connectors path[data-role="parent-origin"]').count(), 0, `${mode}, ${width}: stray grandparent origin`);
      assert.equal(await page.locator('#tree-connectors path[data-role="auxiliary"]').count(), 2);
      assert.equal(await page.locator('.intermediate-node').count(), 1);
      assert.equal(await page.locator('.person[data-person-id="G"]').evaluate(node => node.closest('.generation').dataset.gen), '1');
      assert.equal(await page.locator('.person[data-person-id="C"]').evaluate(node => node.closest('.generation').dataset.gen), '3');
      assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data), initial);
      if (process.env.GRANDPARENT_SCREENSHOTS) await page.locator('#tree-canvas').screenshot({ path: path.join(process.env.GRANDPARENT_SCREENSHOTS, `grandparent-${mode}-${width}.png`) });

      // The remaining connector still supports filling the missing generation.
      await page.locator('.intermediate-node').evaluate(node => node.click());
      await page.locator('#member-name').fill('P');
      await page.locator('#save-member').click();
      await page.waitForFunction(() => FamilyApp.graph().people.length === 3 && !document.querySelector('.intermediate-node'));
      assert.equal(await page.locator('#tree-connectors path[data-role="parent-origin"]').count(), 2);
      assert.equal(await page.locator('#tree-connectors path[data-role="child"]').count(), 3, 'both parent edges and the recorded grandparent edge remain');

      const married = { schemaVersion: 2, people: [person('G', [{ type: 'spouse', personId: 'H' }]), person('H'), person('C', [grandparent('G'), grandparent('H')])] };
      const shared = { schemaVersion: 2, people: [person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]), person('C', [grandparent('G')])] };
      const ignored = { ...initial, ignoredIntermediatePlans: Model.intermediatePlans(initial).map(plan => plan.id) };
      const four = { schemaVersion: 2, people: [...['G', 'H', 'I', 'J'].map(id => person(id)), person('C', ['G', 'H', 'I', 'J'].map(grandparent))] };
      for (const [data, origins, slots, marriages] of [[married, 2, 2, 1], [shared, 1, 1, 0], [ignored, 1, 0, 0], [four, 0, 4, 0]]) {
        await page.evaluate(data => FamilyApp.importFamily({ data, version: FamilyApp.snapshot().version }), data);
        assert.equal(await page.locator('#tree-connectors path[data-role="parent-origin"]').count(), origins);
        assert.equal(await page.locator('.intermediate-node').count(), slots);
        assert.equal(await page.locator('#tree-connectors path[data-role="marriage"]').count(), marriages);
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data), data);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: grandparent connectors, missing-parent creation, marriage and shared origins in API/static desktop/mobile');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
