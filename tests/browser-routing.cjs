// Run with node tests/browser-routing.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
const data = { schemaVersion: 2, people: [
  person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]),
  person('C', [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'grandparent', personId: 'G', kind: '契子女' }])
] };
async function check(page, scenario) {
  const collisions = await page.evaluate(() => {
    const canvas = document.getElementById('tree-canvas').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.person')].map(node => {
      const r = node.getBoundingClientRect();
      return { id: node.dataset.personId, left: r.left - canvas.left, right: r.right - canvas.left, top: r.top - canvas.top, bottom: r.bottom - canvas.top };
    });
    const found = [];
    for (const line of document.querySelectorAll('#tree-connectors path[data-role]')) {
      const points = line.dataset.points.split(' ').map(pair => pair.split(',').map(Number));
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]];
        for (const box of boxes) {
          const crosses = a[0] === b[0]
            ? a[0] > box.left + .5 && a[0] < box.right - .5 && Math.max(a[1], b[1]) > box.top + .5 && Math.min(a[1], b[1]) < box.bottom - .5
            : a[1] > box.top + .5 && a[1] < box.bottom - .5 && Math.max(a[0], b[0]) > box.left + .5 && Math.min(a[0], b[0]) < box.right - .5;
          if (crosses) found.push({ role: line.dataset.role, person: box.id, a, b });
        }
      }
    }
    return found;
  });
  assert.deepEqual(collisions, [], scenario);
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-routing-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(data));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.FAMILY?.people.length === 3);
    await check(page, 'grandparent line avoids the intermediate parent');
    if (process.env.ROUTING_SCREENSHOT) await page.locator('#tree-canvas').screenshot({ path: process.env.ROUTING_SCREENSHOT });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await check(page, 'mobile resize');
    await page.locator('#family-filter').selectOption('u1');
    await check(page, 'filtered family');
    await page.locator('#family-filter').selectOption('');
    // Many mentor and peer lines need enough vertical room above every row.
    const dense = structuredClone(data);
    for (let i = 0; i < 32; i++) dense.people.push(person('T' + i, [
      { type: 'sibling', personId: 'P' }, { type: 'teacher', personId: 'G' }, { type: 'student', personId: 'C' }
    ]));
    dense.people[1].position = '很長的職位說明'.repeat(12);
    await fs.writeFile(dataFile, JSON.stringify(dense));
    await page.reload();
    await page.waitForFunction(() => window.FAMILY?.people.length === 35);
    await check(page, 'dense relationships and tall cards');
    await fs.writeFile(dataFile, JSON.stringify(require('../data/family.json')));
    await page.reload();
    await page.waitForFunction(count => window.FAMILY?.people.length === count, require('../data/family.json').people.length);
    await check(page, 'existing family dataset');
    assert.deepEqual(errors, []);
    console.log('PASS: no connector intersects any member card (grandparents, resize, filter, dense mentors and siblings)');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
