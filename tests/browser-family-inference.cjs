// Run with node tests/browser-family-inference.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const person = (id, gender = 'M', relationships = []) => ({ id, name: id, gender, location: '', position: '', siblingOrder: null, relationships });
const child = personId => ({ type: 'child', personId, kind: '親生' });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const initial = { schemaVersion: 2, familyName: '自動親屬測試', people: [person('A'),
  person('B', 'M', [{ type: 'tangCousin', personId: 'A', seniority: 'older' }]),
  person('C', 'M', [{ type: 'sibling', personId: 'A', seniority: 'older' }])] };
const sourceData = data => ({ ...data, people: data.people.map(({ inferredRelationships, ...person }) => person) });

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-inference-'));
  const dataFile = path.join(dir, 'family.json'), server = createFamilyServer({ dataFile });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }) });
    for (const mode of ['api', 'static']) for (const [width, height] of [[1280, 900], [390, 900], [844, 390]]) {
      await fs.writeFile(dataFile, JSON.stringify(initial));
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      context.setDefaultTimeout(15_000);
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({ browserStorage: true });
        await context.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: html }));
        await context.addInitScript(data => {
          if (!localStorage.getItem('inference-test-seeded')) {
            localStorage.setItem('family-static-v1:/', JSON.stringify({ data, version: 'old-family' }));
            localStorage.setItem('inference-test-seeded', 'true');
          }
        }, initial);
      }
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.find(p => p.id === 'C')?.inferredRelationships?.some(r => r.personId === 'B' && r.type === 'tangCousin'));
      const migrated = await page.evaluate(() => FamilyApp.snapshot());
      assert.deepEqual(sourceData(migrated.data), initial, 'automatic backfill preserves source relationships');
      assert(migrated.data.people.find(p => p.id === 'B').inferredRelationships.some(r => r.personId === 'C'));
      assert.equal((await page.evaluate(() => FamilyRepository.read())).version, migrated.version, 'repeated reads do not create new versions');
      const inferred = page.locator('#tree-connectors [data-inferred="true"]');
      const assertInferredVisible = async visible => {
        assert(await inferred.count() > 0, 'inferred connectors, labels and endpoints exist');
        assert(await inferred.evaluateAll((nodes, visible) => nodes.every(node => (getComputedStyle(node).display !== 'none') === visible), visible));
      };
      const toggleInferred = async () => {
        await page.locator(width > 700 ? height > 520 ? '#desktop-more-open' : '#landscape-more-open' : '#portrait-more-open').click();
        await page.locator('#toggle-inferred-lines').click();
        await page.locator('#landscape-more-close').click();
      };
      await page.waitForSelector('#toggle-inferred-lines[data-action="inferred-lines"]', { state: 'attached' });
      assert.equal(await page.locator('#toggle-inferred-lines').getAttribute('aria-pressed'), 'false');
      await assertInferredVisible(false);
      assert(await page.locator('#tree-connectors path[data-kind="堂親"]:not([data-inferred])').count() > 0, 'shared manual cousin strokes remain');
      assert(await page.locator('#tree-connectors path[data-kind="堂親"]:not([data-inferred])').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
      assert(await page.locator('#tree-connectors text[data-inferred="true"]').count() > 0);
      assert(await page.locator('#tree-connectors path[data-inferred="true"][marker-end]').count() > 0, 'inferred branch endpoint is classified separately');
      if (process.env.INFERENCE_SCREENSHOTS && mode === 'static') {
        await page.screenshot({ path: path.join(process.env.INFERENCE_SCREENSHOTS, `inference-overview-${width}.png`) });
        await page.locator(width > 700 ? height > 520 ? '#desktop-more-open' : '#landscape-more-open' : '#portrait-more-open').click();
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(process.env.INFERENCE_SCREENSHOTS, `inference-menu-${width}.png`) });
        await page.locator('#landscape-more-close').click();
      }
      await page.evaluate(() => { window.inferenceTestSvg = document.getElementById('tree-connectors'); });
      await toggleInferred();
      assert.equal(await page.locator('#toggle-inferred-lines').getAttribute('aria-pressed'), 'true');
      await assertInferredVisible(true);
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('family-tree:canvas-view:v1:/') || 'null')?.showInferredLines === true);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#tree-connectors [data-inferred="true"]'));
      assert.equal(await page.locator('#toggle-inferred-lines').getAttribute('aria-pressed'), 'true', 'the tab remembers the overview preference');
      await assertInferredVisible(true);
      await page.evaluate(() => { window.inferenceTestSvg = document.getElementById('tree-connectors'); });
      await toggleInferred();
      await assertInferredVisible(false);
      await page.locator('.person[data-person-id="A"]').evaluate(node => node.click());
      await assertInferredVisible(true); // Includes branches unrelated to the selected member.
      assert.equal(await page.locator('#toggle-inferred-lines').getAttribute('aria-pressed'), 'false', 'selection only overrides display');
      await page.keyboard.press('Escape');
      await assertInferredVisible(false);
      await page.evaluate(() => dispatchEvent(new CustomEvent('familytreeselect', { detail: { id: 'B' } })));
      await assertInferredVisible(true);
      await page.locator('.details-close').click();
      await assertInferredVisible(false);
      await page.locator('.person[data-person-id="C"]').evaluate(node => node.click());
      await assertInferredVisible(true);
      await toggleInferred();
      await toggleInferred();
      await assertInferredVisible(true); // Turning it off cannot hide lines during selection.
      assert(await page.evaluate(() => window.inferenceTestSvg === document.getElementById('tree-connectors')), 'toggle and selection preserve the canvas');
      if (await page.locator('.relationship-details__tab').isVisible()) await page.locator('.relationship-details__tab').click();
      await page.locator('[data-group="cousins"]').evaluate(node => { node.open = true; });
      assert.match(await page.locator('[data-group="cousins"]').textContent(), /堂兄弟/);
      assert.match(await page.locator('[data-group="cousins"]').textContent(), /自動辨別/);
      assert(await page.evaluate(() => FamilyApp.graph().bonds.some(b => b.inferred && b.members.includes('B') && b.members.includes('C'))));
      if (process.env.INFERENCE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.INFERENCE_SCREENSHOTS, `inference-${mode}-${width}.png`) });
      await page.locator('.person[data-person-id="C"]').evaluate(node => node.click());
      await assertInferredVisible(false);
      assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot()), migrated, 'visibility changes never write family data or versions');
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('family-tree:canvas-view:v1:/') || 'null')?.showInferredLines === false);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#tree-connectors [data-inferred="true"]'));
      await assertInferredVisible(false);

      // Query paths remain available even with the overview toggle disabled.
      await page.evaluate(() => {
        for (const [id, value] of [['relationship-a', 'C'], ['relationship-b', 'B']]) {
          const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await page.waitForFunction(() => !document.querySelector('#relationship-search [type="submit"]').disabled);
      await page.locator('#relationship-search').evaluate(form => form.requestSubmit());
      assert(await page.locator('#relationship-summary').isVisible());
      assert.match(await page.locator('#relationship-summary').textContent(), /堂/);
      assert(await inferred.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display !== 'none')));
      await page.locator('.relationship-result-end').click();
      await assertInferredVisible(false);

      const add = member => page.evaluate(async member => {
        const requestId = crypto.randomUUID();
        const body = { member, requestId, version: FamilyApp.snapshot().version };
        const result = await FamilyApp.addMember(body);
        const retry = await FamilyApp.addMember(body);
        if (result.version !== retry.version) throw new Error('retry changed the saved version');
        return result.memberId;
      }, member);
      const daughterId = await add(person('D', 'F', [parent('A')]));
      const grandfatherId = await add(person('G', 'M', [child('A')]));
      const state = await page.evaluate(() => FamilyApp.snapshot().data);
      const daughter = state.people.find(p => p.id === daughterId);
      assert(daughter.inferredRelationships.some(r => r.type === 'uncleAunt' && r.personId === 'C'));
      assert(daughter.inferredRelationships.some(r => r.type === 'grandparent' && r.personId === grandfatherId && r.lineage === 'paternal'));

      // Import another branch without precomputed records; identify maternal ancestors.
      const expanded = { ...state, people: [...sourceData(state).people, person('H'), person('M', 'F', [parent('H')]), person('N', 'M', [parent('M')])] };
      await page.evaluate(data => FamilyApp.importFamily({ data, version: FamilyApp.snapshot().version }), expanded);
      assert((await page.evaluate(() => FamilyApp.snapshot().data)).people.find(p => p.id === 'N').inferredRelationships.some(r => r.personId === 'H' && r.lineage === 'maternal'));
      await page.reload();
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.some(p => p.id === 'N'));
      assert.deepEqual(await page.evaluate(() => FamilyRepository.exportData()), await page.evaluate(() => FamilyApp.snapshot().data));
      if (mode === 'api') assert.deepEqual(JSON.parse(await fs.readFile(dataFile, 'utf8')), await page.evaluate(() => FamilyApp.snapshot().data));

      // Editing the actual premise withdraws its consequences; undo restores them.
      await page.evaluate(() => {
        const member = { ...FamilyApp.snapshot().data.people.find(p => p.id === 'C'), relationships: [] };
        return FamilyApp.updateMember('C', { member, version: FamilyApp.snapshot().version });
      });
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'C').inferredRelationships?.some(r => r.personId === 'B')), undefined);
      assert.equal(await page.evaluate(id => FamilyApp.snapshot().data.people.find(p => p.id === id).inferredRelationships.some(r => r.type === 'uncleAunt' && r.personId === 'C'), daughterId), false);
      await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
      assert(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'C').inferredRelationships.some(r => r.personId === 'B')));

      if (mode === 'static') {
        // A cloud download of old JSON is enriched locally and queued for ordinary sync.
        await page.evaluate(data => FamilyRepository.replaceFromCloud(data, { fileId: 'remote', remoteVersion: '1' }, FamilyApp.snapshot().version), initial);
        const downloaded = await page.evaluate(() => FamilyRepository.read());
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data), downloaded.data, 'cloud download updates the visible application immediately');
        assert(downloaded.data.people.find(p => p.id === 'C').inferredRelationships.some(r => r.personId === 'B'));
        assert.equal((await page.evaluate(() => FamilyRepository.getSyncState())).dirty, true);
        assert.equal((await page.evaluate(() => FamilyRepository.read())).version, downloaded.version);
      }
      // Completing an inferred biao cousin must open the biao editor, not tang.
      const biao = { ...initial, people: initial.people.map(p => p.id === 'B'
        ? { ...p, relationships: [{ type: 'biaoCousin', personId: 'A' }] } : p) };
      await page.evaluate(data => FamilyApp.importFamily({ data, version: FamilyApp.snapshot().version }), biao);
      await page.reload();
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.find(p => p.id === 'C')?.inferredRelationships?.some(r => r.type === 'biaoCousin'));
      await page.locator('.person[data-person-id="C"]').evaluate(node => node.click());
      if (await page.locator('.relationship-details__tab').isVisible()) await page.locator('.relationship-details__tab').click();
      await page.locator('[data-group="cousins"]').evaluate(node => { node.open = true; });
      await page.locator('[data-group="cousins"] .relationship-missing').filter({ hasText: '長幼' }).click();
      await page.waitForFunction(() => document.getElementById('member-dialog').open);
      const types = await page.locator('#member-dialog .relation-type').evaluateAll(nodes => nodes.map(node => node.value));
      assert(types.includes('biaoCousin'));
      assert(!types.includes('tangCousin'));
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: inferred line visibility and tab preference, selection overrides, shared manual strokes, query paths, existing-data backfill, kinship UI, add/retry, import/export, source edits, undo/reload and cloud download in API/static desktop/mobile');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
