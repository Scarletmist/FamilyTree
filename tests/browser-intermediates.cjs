const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
const initial = { schemaVersion: 2, people: [person('A'), person('B', [{ type: 'tangCousin', personId: 'A', seniority: 'older' }])] };
async function checkGeometry(page) {
  const invalid = await page.evaluate(() => {
    const root = document.getElementById('tree-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.person')].map(el => el.getBoundingClientRect());
    const segments = [...document.querySelectorAll('#tree-connectors path[data-role]')].flatMap(el => { const points = el.dataset.points.split(' ').map(pair => pair.split(',').map(Number)); return points.slice(1).map((b, i) => [{ x: points[i][0], y: points[i][1] }, { x: b[0], y: b[1] }]); });
    const errors = [];
    for (const [a, b] of segments) for (const c of cards) {
      const left = c.left - root.left, right = c.right - root.left, top = c.top - root.top, bottom = c.bottom - root.top;
      if (a.x === b.x ? a.x > left + .5 && a.x < right - .5 && Math.max(a.y, b.y) > top + .5 && Math.min(a.y, b.y) < bottom - .5 : a.y > top + .5 && a.y < bottom - .5 && Math.max(a.x, b.x) > left + .5 && Math.min(a.x, b.x) < right - .5) errors.push('line overlaps card');
    }
    for (const node of document.querySelectorAll('.intermediate-node')) {
      const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (cards.some(c => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top)) errors.push('button overlaps card');
      const px = x - root.left, py = y - root.top;
      if (!segments.some(([a, b]) => a.x === b.x ? Math.abs(px - a.x) < 1 && py >= Math.min(a.y, b.y) - 1 && py <= Math.max(a.y, b.y) + 1 : Math.abs(py - a.y) < 1 && px >= Math.min(a.x, b.x) - 1 && px <= Math.max(a.x, b.x) + 1)) errors.push('button detached from line');
    }
    return errors;
  });
  assert.deepEqual(invalid, []);
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-intermediates-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(initial));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const mode of ['api', 'static']) {
      const context = await browser.newContext({ viewport: mode === 'api' ? { width: 1280, height: 900 } : { width: 390, height: 844 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      if (mode === 'static') {
        const html = (await fs.readFile(path.join(__dirname, '../family-tree.html'), 'utf8')).replace('<head>', '<head><meta name="family-storage-mode" content="browser">');
        await page.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.addInitScript(data => {
          if (!localStorage.getItem('family-static-v1:/')) localStorage.setItem('family-static-v1:/', JSON.stringify({ data, version: 'initial' }));
        }, initial);
      }
      await page.goto(base);
      await page.waitForFunction(() => window.FAMILY?.people.length === 2);
      assert.equal(await page.locator('.intermediate-node').count(), 2);
      assert.equal(await page.locator('.intermediate-node[data-gen="1"]').count(), 2, 'unanchored parent placeholders stop at generation one');
      assert.equal(await page.locator('.generation[data-gen="1"] .person').count(), 2, 'placeholders do not shift member generations');
      await checkGeometry(page);
      if (mode === 'api' && process.env.INTERMEDIATE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.INTERMEDIATE_SCREENSHOTS, 'intermediate-two.png') });
      const readRows = () => page.locator('.relation-row').evaluateAll(rows => rows.map(row => ({ type: row.querySelector('.relation-type').value, personId: row.querySelector('.relation-target').value, kind: row.querySelector('.relation-kind').value })));
      // Cancel does not create a member or consume the placeholder.
      await page.locator('.intermediate-node[data-near="A"]').click();
      assert.deepEqual(await readRows(), [{ type: 'child', personId: 'A', kind: '親生' }]);
      await page.locator('#cancel-member').click();
      assert.equal(await page.locator('.intermediate-node').count(), 2);
      await page.locator('.intermediate-node[data-near="A"]').click();
      await page.locator('#member-name').fill('C');
      await page.locator('[name="siblingOrder"]').fill('1');
      await page.locator('#save-member').click();
      await page.waitForFunction(() => window.FAMILY.people.length === 3);
      const c = await page.evaluate(() => FAMILY.people.find(p => p.name === 'C').id);
      assert.equal(await page.locator('.intermediate-node').count(), 1);
      const generationOf = id => page.locator(`.person[data-person-id="${id}"]`).evaluate(node => Number(node.closest('.generation').dataset.gen));
      assert.equal(await generationOf('A'), await generationOf('B'));
      assert.equal(await generationOf(c), await generationOf('A') - 1);
      const endpoints = await page.evaluate(() => {
        const root = document.getElementById('tree-canvas').getBoundingClientRect();
        const members = [...document.querySelectorAll('.person')].map(el => ({ id: el.dataset.personId, r: el.getBoundingClientRect() }));
        const hits = new Set();
        document.querySelectorAll('#tree-connectors path[data-kind="堂親"]').forEach(line => {
          const points = line.dataset.points.split(' ').map(pair => pair.split(',').map(Number));
          for (const p of [points[0], points[points.length - 1]]) for (const { id, r } of members) {
            if (p[0] + root.left >= r.left && p[0] + root.left <= r.right && (Math.abs(p[1] + root.top - r.top) < 1 || Math.abs(p[1] + root.top - r.bottom) < 1)) hits.add(id);
          }
        });
        return [...hits].sort();
      });
      assert.deepEqual(endpoints, ['A', 'B']);
      await checkGeometry(page);
      if (mode === 'api' && process.env.INTERMEDIATE_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.INTERMEDIATE_SCREENSHOTS, 'intermediate-one.png') });
      await page.locator('.intermediate-node[data-near="B"]').click();
      const rows = await readRows();
      assert.match(await page.locator('.relation-preview').last().textContent(), /親生手足/);
      assert.deepEqual(rows.map(({ type, personId }) => ({ type, personId })), [{ type: 'child', personId: 'B' }, { type: 'sibling', personId: c }]);
      await page.locator('#member-name').fill('D');
      await page.locator('#save-member').click();
      await page.waitForFunction(() => window.FAMILY.people.length === 4);
      assert.equal(await page.locator('.intermediate-node[data-plan-id^="堂親"]').count(), 0);
      assert.equal(await page.locator('#tree-connectors [data-kind="堂親"]').count(), 0);
      // The newly established biological siblings offer their shared parent next.
      assert.equal(await page.locator('.intermediate-node[data-plan-id^="手足"]').count(), 1);
      await page.reload();
      await page.waitForFunction(() => window.FAMILY?.people.length === 4);
      const d = await page.evaluate(() => FAMILY.people.find(p => p.name === 'D'));
      assert(d.relationships.some(r => r.type === 'child' && r.personId === 'B' && r.kind === '親生'));
      assert(d.relationships.some(r => r.type === 'sibling' && r.personId === c));
      await page.evaluate(id => window.selectFamilyMember(id), d.id);
      assert.match(await page.locator('[data-group="siblings"]').textContent(), /長兄/);
      await page.evaluate(id => window.selectFamilyMember(id), c);
      assert.match(await page.locator('[data-group="siblings"]').textContent(), /弟/);
      assert.deepEqual(errors, []);
      await context.close();
    }
    // An ambiguous biao route requires an explicit parent selection in the form.
    const ambiguous = structuredClone(initial);
    ambiguous.people[1].relationships[0].type = 'biaoCousin';
    ambiguous.people.push(person('C', [{ type: 'child', personId: 'A', kind: '親生' }]), { ...person('D', [{ type: 'child', personId: 'A', kind: '親生' }]), gender: 'F' });
    await fs.writeFile(dataFile, JSON.stringify(ambiguous));
    const page = await browser.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.FAMILY?.people.length === 4);
    await page.locator('.intermediate-node[data-near="B"]').click();
    assert.equal(await page.locator('#intermediate-choice').evaluate(el => el.validity.valid), false);
    await page.locator('#intermediate-choice').locator('..').locator('.select-trigger').click();
    await page.locator('.select-dropdown:popover-open [role=option]').filter({ hasText: /^D$/ }).click();
    assert.equal(await page.locator('.relation-row').last().locator('.relation-target').inputValue(), 'D');
    await page.locator('#cancel-member').click();
    assert.equal(JSON.parse(await fs.readFile(dataFile, 'utf8')).people.length, 4);
    // Keyboard activation and prefilled biological grandparent / sibling paths.
    for (const [type, kind, expected] of [['grandchild', '親生', 1], ['grandchild', '契子女', 0], ['sibling', null, 1]]) {
      const r = { type, personId: 'B', ...(kind ? { kind } : {}) };
      await fs.writeFile(dataFile, JSON.stringify({ schemaVersion: 2, people: [person('A', [r]), person('B')] }));
      await page.reload();
      await page.waitForFunction(() => window.FAMILY?.people.length === 2);
      assert.equal(await page.locator('.intermediate-node').count(), expected);
      if (expected) {
        await checkGeometry(page);
        await page.locator('.intermediate-node').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.relation-row').count(), 2);
        assert.deepEqual(await page.locator('.relation-kind').evaluateAll(nodes => nodes.map(n => n.value)), ['親生', '親生']);
        await page.locator('#cancel-member').click();
      }
    }
    const parent = personId => ({ type: 'parent', personId, kind: '親生' });
    const fourth = { schemaVersion: 2, people: [person('G'), person('H', [parent('G')]), person('I', [parent('H')]), person('X', [parent('I')]), person('Y', [parent('I')]), person('A', [{ type: 'spouse', personId: 'X' }, { type: 'tangCousin', personId: 'B' }]), person('B', [{ type: 'spouse', personId: 'Y' }])] };
    await fs.writeFile(dataFile, JSON.stringify(fourth));
    await page.reload();
    await page.waitForFunction(() => window.FAMILY?.people.length === 7);
    assert.equal(await page.locator('.generation[data-gen="4"] .person[data-person-id="A"]').count(), 1);
    assert.equal(await page.locator('.intermediate-node[data-gen="3"]').count(), 2);
    assert(await page.locator('.intermediate-node').evaluateAll(nodes => nodes.every(node => {
      const band = document.querySelector('.tree__generation-band[data-gen="3"]').getBoundingClientRect(), box = node.getBoundingClientRect();
      return box.top >= band.top && box.bottom <= band.bottom;
    })));
    await checkGeometry(page);
    if (process.env.INTERMEDIATE_SCREENSHOTS) {
      await page.locator('.intermediate-node').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.INTERMEDIATE_SCREENSHOTS, 'intermediate-third-generation.png') });
    }
    const shared = { schemaVersion: 2, people: [person('A', [{ type: 'tangCousin', personId: 'B' }, { type: 'tangCousin', personId: 'C' }]), person('B', [{ type: 'sibling', personId: 'C' }]), person('C')] };
    await fs.writeFile(dataFile, JSON.stringify(shared));
    await page.reload();
    await page.waitForFunction(() => window.FAMILY?.people.length === 3);
    const aSlot = page.locator('.intermediate-node[data-near="A"]');
    assert.equal(await aSlot.count(), 1);
    assert.equal(await page.evaluate(() => FAMILY.bonds.filter(b => b.kind === '堂親').length), 2);
    await checkGeometry(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await aSlot.count(), 1);
    await aSlot.click();
    assert.equal(await page.locator('.relation-row').count(), 1);
    assert.equal(await page.locator('.relation-target').inputValue(), 'A');
    await page.locator('#cancel-member').click();
    assert.equal(await aSlot.count(), 1);
    await aSlot.click();
    await page.locator('#member-name').fill('A的父親');
    await page.locator('#save-member').click();
    await page.waitForFunction(() => window.FAMILY.people.length === 4);
    assert.equal(await aSlot.count(), 0);
    await page.reload();
    await page.waitForFunction(() => window.FAMILY?.people.length === 4);
    assert.equal(await aSlot.count(), 0);
    assert.equal(await page.evaluate(() => FAMILY.bonds.filter(b => b.kind === '堂親').length), 2);
    await page.close();
    console.log('PASS: A/B → C → D, automatic relationships, cancel, reload, API and static mobile');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
