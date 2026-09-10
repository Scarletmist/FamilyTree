const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-sharing-'));
  const dataFile = path.join(dir, 'family.json');
  const data = { schemaVersion: 2, people: [
    person('A', [{ type: 'student', personId: 'B' }, { type: 'student', personId: 'C' }]), person('B'), person('C'),
    person('D', [{ type: 'tangCousin', personId: 'E' }, { type: 'tangCousin', personId: 'F' }]),
    person('E', [{ type: 'sibling', personId: 'F' }]), person('F'),
    person('G', [{ type: 'biaoCousin', personId: 'H' }, { type: 'biaoCousin', personId: 'I' }]), person('H'), person('I')
  ] };
  await fs.writeFile(dataFile, JSON.stringify(data));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.FAMILY?.people.length === 9 && document.querySelector('path[data-group^="shared:"]'));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const paths = [...document.querySelectorAll('#tree-connectors path[data-points]')];
        const groups = kind => [...new Set(paths.filter(p => p.dataset.kind === kind).map(p => p.dataset.group))];
        const shared = paths.filter(p => p.dataset.group.startsWith('shared:'));
        const segments = shared.flatMap(p => FamilyConnectorRouting.segments(p.dataset.points.split(' ').map(v => v.split(',').map(Number)), { group: p.dataset.group }));
        return { mentor: groups('師徒'), tang: groups('堂親'), biao: groups('表親'),
          overlap: segments.some((s, i) => segments.slice(i + 1).some(t => s.group === t.group && FamilyConnectorRouting.overlapLength(s, t) > .01)),
          trunk: shared.some(p => p.dataset.people.split(' ').sort().join('') === 'ABC'),
          fatherSlots: document.querySelectorAll('.intermediate-node[data-near="D"]').length };
      });
      assert.equal(state.mentor.length, 1); assert.equal(state.tang.length, 1); assert.equal(state.biao.length, 2);
      assert.equal(state.overlap, false); assert.equal(state.trunk, true); assert.equal(state.fatherSlots, 1);
    }
    await page.locator('.person[data-person-id="B"]').evaluate(el => el.click());
    const highlight = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#tree-connectors path[data-kind="師徒"]')];
      return {
        trunk: paths.filter(p => p.dataset.people.split(' ').length === 3).every(p => p.style.opacity === '1'),
        otherBranch: paths.filter(p => p.dataset.people.split(' ').sort().join('') === 'AC').every(p => p.style.opacity === '0.12')
      };
    });
    assert.equal(highlight.trunk, true); assert.equal(highlight.otherBranch, true);
    await page.locator('.person[data-person-id="B"]').evaluate(el => el.click());
    const crossingCase = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#tree-connectors path[data-points]')];
      for (let index = 0; index < paths.length; index++) {
        const p = paths[index];
        if (!p.getAttribute('d').includes(' A ')) continue;
        const bridges = (p.dataset.bridges || '').split(' ').filter(Boolean).map(v => v.split(',').map(Number));
        for (const id of p.dataset.people.split(' ')) {
          const relevantCrossing = paths.some(q => q !== p && q.dataset.group !== p.dataset.group && q.dataset.people.split(' ').includes(id) &&
            FamilyConnectorRouting.segments(q.dataset.points.split(' ').map(v => v.split(',').map(Number))).some(s => bridges.some(([x, y]) =>
              s.axis === 'h' ? Math.abs(y - s.fixed) < .1 && x > s.min && x < s.max : Math.abs(x - s.fixed) < .1 && y > s.min && y < s.max)));
          if (!relevantCrossing) return { index, id, original: p.getAttribute('d') };
        }
      }
    });
    assert(crossingCase, 'fixture contains a bridge over an unrelated line');
    await page.locator(`.person[data-person-id="${crossingCase.id}"]`).evaluate(el => el.click());
    const bridgePath = page.locator('#tree-connectors path[data-points]').nth(crossingCase.index);
    assert(!(await bridgePath.getAttribute('d')).includes(' A '), 'unrelated crossing becomes straight on selection');
    await page.locator(`.person[data-person-id="${crossingCase.id}"]`).evaluate(el => el.click());
    assert.equal(await bridgePath.getAttribute('d'), crossingCase.original, 'cancel restores the exact original bridge');
    if (process.env.SHARING_SCREENSHOT) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.waitForTimeout(300);
      await page.locator('#tree-canvas').screenshot({ path: process.env.SHARING_SCREENSHOT });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: shared teacher/cousin trunks, independent uncertain biao branches, unique father slot, desktop and mobile');
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
