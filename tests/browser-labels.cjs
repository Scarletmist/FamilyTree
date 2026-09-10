const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFamilyServer } = require('../server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
const kinds = ['親生', '過繼', '養子女', '義子女', '契子女'];
const data = { schemaVersion: 2, people: [person('P'), ...['A', 'B', 'C'].map(id => person(id, kinds.map(kind => ({ type: 'parent', personId: 'P', kind }))))] };
async function check(page) {
  const result = await page.evaluate(() => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.left - 3, y: b.top - 3, width: b.width + 6, height: b.height + 6 }; };
    const labels = [...document.querySelectorAll('.relation-label')].map(rect);
    const obstacles = [...document.querySelectorAll('.person, .intermediate-node')].map(rect);
    const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    return { count: labels.length, collisions: labels.flatMap((label, i) => [...labels.slice(i + 1), ...obstacles].filter(other => overlap(label, other))) };
  });
  assert.equal(result.count, 15);
  assert.deepEqual(result.collisions, []);
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-labels-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(data));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.FAMILY?.people.length === 4);
    await check(page);
    if (process.env.LABEL_SCREENSHOT) await page.screenshot({ path: process.env.LABEL_SCREENSHOT });
    const before = await page.locator('#tree-canvas').evaluate(el => el.getBoundingClientRect().height);
    await page.evaluate(() => window.renderFamilyTree());
    await check(page);
    assert.equal(await page.locator('#tree-canvas').evaluate(el => el.getBoundingClientRect().height), before);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await check(page);
    await page.evaluate(() => window.selectFamilyMember('A'));
    await check(page);
    assert.deepEqual(errors, []);
    console.log('PASS: 15 coincident relationship labels avoid each other and member cards; desktop, mobile, selection and redraw.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
