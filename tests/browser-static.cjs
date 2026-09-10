const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { build } = require('../build.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const p = (id, relationships = [], notes = '') => ({ id, name: id, gender: 'U', location: '', position: '', siblingOrder: null, relationships, notes });
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-static-'));
  await build(dir);
  await assert.rejects(fs.access(path.join(dir, 'data/family.json')));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push(req.url);
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/repo/')) throw new Error('Outside project');
      const file = path.join(dir, pathname.slice(6) || 'index.html');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const url = 'http://127.0.0.1:' + server.address().port + '/repo/';
    await page.goto(url); await page.waitForFunction(() => window.FAMILY);
    assert.equal(await page.locator('.person').count(), 0);
    await page.click('#add-member'); await page.fill('#member-name', '第一位'); await page.fill('#member-notes', '第一行\n<script>只是文字</script>'); await page.click('#save-member');
    await page.waitForFunction(() => window.FAMILY.people.length === 1);
    assert.equal(await page.locator('.person').getAttribute('title'), null);
    await page.locator('.person').hover();
    await page.waitForFunction(() => document.getElementById('member-tooltip')?.classList.contains('is-visible'));
    assert.equal(await page.locator('#member-tooltip-name').textContent(), '第一位');
    assert.equal(await page.locator('#member-tooltip-body').textContent(), '第一行\n<script>只是文字</script>');
    const tooltipBox = await page.locator('#member-tooltip').boundingBox();
    assert(tooltipBox.x >= 0 && tooltipBox.y >= 0 && tooltipBox.x + tooltipBox.width <= 1440 && tooltipBox.y + tooltipBox.height <= 960);
    assert.match(await page.locator('.member-notes__text').textContent(), /<script>只是文字/);
    await page.locator('[data-group=notes] summary').click();
    await page.evaluate(() => window.renderFamilyTree());
    assert.equal(await page.locator('[data-group=notes]').evaluate(n => n.open), false);
    await page.reload(); await page.waitForFunction(() => window.FAMILY?.people.length === 1);
    await page.evaluate(() => window.editFamilyMember(FAMILY.people[0].id));
    assert.match(await page.inputValue('#member-notes'), /第一行/);
    await page.fill('#member-notes', '更新備註'); await page.click('#save-member');
    await page.waitForFunction(() => FAMILY.people[0].notes === '更新備註');
    await page.click('#edit-family-name'); await page.fill('#family-name-input', '靜態族譜'); await page.click('#save-family-name');
    await page.waitForFunction(() => FAMILY.familyName === '靜態族譜');
    const fixture = { schemaVersion: 2, people: [p('G'), p('S', [{ type: 'parent', personId: 'G', kind: '親生' }]), p('F', [{ type: 'fellowDisciple', personId: 'S' }], '同門備註')] };
    fixture.people[1].gender = 'M'; fixture.people[1].discipleOrder = 1; fixture.people[2].gender = 'F';
    await page.locator('#import-file').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.click('#confirm-import'); await page.waitForFunction(() => FAMILY.people.length === 3);
    assert.equal(await page.evaluate(() => FAMILY.people.find(p => p.id === 'F').gen), 2);
    assert.equal(await page.locator('[data-kind="師兄弟姊妹"]').count() > 0, true);
    await page.evaluate(() => window.selectFamilyMember('F'));
    assert.match(await page.locator('[data-group=fellowDisciples]').textContent(), /師兄弟姊妹/);
    await page.screenshot({ path: path.join(dir, 'notes-desktop.png') });
    await page.evaluate(() => window.editFamilyMember('F'));
    assert.equal(await page.locator('.relation-type').inputValue(), 'fellowDisciple');
    assert.equal(await page.locator('.relation-seniority').count(), 0);
    await page.fill('#member-disciple-order', '4');
    assert.match(await page.locator('.relation-preview').textContent(), /S是F的師兄/);
    await page.click('#save-member');
    await page.waitForFunction(() => FAMILY.people.find(p => p.id === 'F').discipleOrder === 4);
    fixture.people[2].discipleOrder = 4;
    assert.match(await page.locator('[data-group=fellowDisciples]').textContent(), /師兄/);
    await page.evaluate(() => window.editFamilyMember('S'));
    assert.equal(await page.inputValue('#member-disciple-order'), '1');
    assert.match(await page.locator('.relation-preview').last().textContent(), /F是S的師妹/);
    await page.click('#cancel-member');
    const downloadPromise = page.waitForEvent('download'); await page.click('#export-json');
    const exported = JSON.parse(await fs.readFile(await (await downloadPromise).path(), 'utf8'));
    assert.deepEqual(exported, fixture);
    // A stale tab must not overwrite another tab's persisted changes.
    const other = await page.context().newPage(); await other.goto(url); await other.waitForFunction(() => window.FAMILY);
    const stale = await page.evaluate(async () => (await (await FamilyRepository.request('/api/family')).json()).version);
    await other.evaluate(async () => { const saved = await (await FamilyRepository.request('/api/family')).json(); await FamilyRepository.request('/api/family/name', { method: 'PUT', body: JSON.stringify({ version: saved.version, familyName: '新名稱' }) }); });
    assert.equal(await page.evaluate(async version => (await FamilyRepository.request('/api/family/name', { method: 'PUT', body: JSON.stringify({ version, familyName: '舊分頁' }) })).status, stale), 409);
    // Start with only A/B, then fill their fathers in through the real forms.
    const cousinData = { schemaVersion: 2, people: [{ ...p('A'), gender: 'M' }, { ...p('B'), gender: 'F' }] };
    await page.reload(); await page.waitForFunction(() => window.FAMILY);
    await page.locator('#import-file').setInputFiles({ name: 'cousins.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(cousinData)) });
    await page.click('#confirm-import'); await page.waitForFunction(() => FAMILY.people.length === 2);
    async function choose(selector, label) {
      await page.locator(selector).locator('..').locator('.select-trigger').click();
      await page.locator('.select-dropdown:popover-open input').fill(label);
      await page.locator('.select-dropdown:popover-open').getByRole('option', { name: label, exact: true }).click();
    }
    async function relation(target, type) {
      await page.click('#add-relation');
      await choose('.relation-row:last-child .relation-target', target);
      await choose('.relation-row:last-child .relation-type', type);
    }
    async function save() { await page.click('#save-member'); await page.waitForFunction(() => !document.getElementById('member-dialog').open); }
    await page.evaluate(() => window.editFamilyMember('B'));
    await relation('A', '堂兄弟姊妹（直接設定）');
    await choose('.relation-cousin-seniority', '對方比此成員年長');
    assert.match(await page.locator('.relation-preview').textContent(), /A是B的堂兄/);
    await save();
    assert.equal(await page.locator('.person').count(), 2);
    assert.match(await page.locator('[data-group=cousins]').textContent(), /堂兄/);
    await page.click('#add-member'); await page.fill('#member-name', 'C'); await choose('#member-gender', '男');
    await relation('A', '子女'); await save();
    await page.click('#add-member'); await page.fill('#member-name', 'D'); await choose('#member-gender', '男');
    await relation('B', '子女'); await relation('C', '手足'); await save();
    await choose('#relationship-a', 'A'); await choose('#relationship-b', 'B');
    await page.click('#relationship-search [type=submit]');
    assert.match(await page.locator('#relationship-summary h2').textContent(), /A 為 B 的堂兄/);
    assert.deepEqual((await page.locator('.person__name').allTextContents()).sort(), ['A', 'B', 'C', 'D']);
    const savedCousin = await page.evaluate(() => FamilyModel.relationshipsFor(FAMILY, 'B').find(r => r.type === 'tangCousin'));
    assert.equal(savedCousin.seniority, 'older');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.editFamilyMember('B'));
    assert.equal(await page.locator('#member-dialog').evaluate(n => n.scrollWidth <= n.clientWidth), true);
    await page.screenshot({ path: path.join(dir, 'form-mobile.png') });
    assert.deepEqual(errors, []);
    assert.ok(requests.includes('/repo/data/kinship-terms.json'));
    assert.ok(!requests.some(url => url.includes('/api/') || url.includes('family.json')));
    console.log('Visual checks: ' + dir);
    console.log('PASS: static subpath, empty initial data, add/edit notes, collapse, reload, fellow disciples, import/export, stale tabs, mobile, zero API/developer-data requests.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
