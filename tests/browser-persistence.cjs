// Run with node tests/browser-persistence.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-browser-'));
  const dataFile = path.join(dir, 'family.json');
  const data = { schemaVersion: 2, people: [person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]), person('C', [{ type: 'parent', personId: 'P', kind: '親生' }])] };
  await fs.writeFile(dataFile, JSON.stringify(data));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    let context = await browser.newContext();
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.FAMILY?.people.length === 3);
    await page.evaluate(() => window.editFamilyMember('C'));
    await page.locator('#add-relation').click();
    const row = page.locator('.relation-row').last();
    for (const [selector, value] of [['.relation-target', 'G'], ['.relation-type', 'grandparent'], ['.relation-kind', '契子女']]) {
      const select = row.locator(selector);
      const text = await select.locator('option').evaluateAll((options, value) => options.find(option => option.value === value).textContent, value);
      await select.locator('..').locator('.select-trigger').click();
      await page.locator('.select-dropdown:popover-open input').fill(text);
      await page.locator('.select-dropdown:popover-open [role=option]').filter({ hasText: text }).first().click();
    }
    assert.match(await row.locator('.relation-preview').textContent(), /祖父母.*契子女/);
    await page.locator('#save-member').click();
    await page.waitForFunction(() => !document.getElementById('member-dialog').open);
    assert.match(await page.locator('[data-group="grandparents"]').textContent(), /契祖父/);
    assert.match(await page.locator('#backup-status').textContent(), /Cookie/);
    const state = await context.storageState();
    await context.close();
    context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/family', route => route.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.FAMILY?.people.length === 3);
    assert.match(await page.locator('#backup-status').textContent(), /已還原/);
    assert.equal(await page.locator('#add-member').isDisabled(), true);
    await page.evaluate(() => window.selectFamilyMember('G'));
    assert.match(await page.locator('[data-group="grandchildren"]').textContent(), /契孫子/);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#export-json').click();
    const download = await downloadEvent;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert(exported.people.find(p => p.id === 'C').relationships.some(r => r.type === 'grandparent'));
    await page.unroute('**/api/family');
    const current = await (await fetch(base + '/api/family')).json();
    current.data.notes = '大族譜'.repeat(3000);
    await fs.writeFile(dataFile, JSON.stringify(current.data));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('localStorage'));
    await page.route('**/api/family', route => route.abort());
    await page.reload();
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('已還原'));
    assert.equal(await page.evaluate(() => FamilyStorage.create(window, FamilyModel.build).read().data.notes.length), 9000);
    // Sparse generations and all four direct grandparents must still draw.
    await page.unroute('**/api/family');
    const grandIds = ['A', 'B', 'D', 'E'];
    await fs.writeFile(dataFile, JSON.stringify({ schemaVersion: 2, people: [
      ...grandIds.map(id => person(id)),
      person('C', grandIds.map(id => ({ type: 'grandparent', personId: id, kind: '契子女' })))
    ] }));
    await page.reload();
    await page.waitForFunction(() => window.FAMILY?.people.length === 5);
    assert.equal(await page.locator('.generation[data-gen="2"]').count(), 1);
    assert.equal(await page.locator('#tree-connectors [data-role="parent-origin"]').count(), 4);
    await page.evaluate(() => window.selectFamilyMember('C'));
    assert.equal(await page.locator('[data-group="grandparents"] .relationship-entry').count(), 4);
    assert.deepEqual(errors, []);
    console.log('PASS: relationship form, inverse details, Cookie reopen, localStorage fallback, offline export, mobile rendering');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
