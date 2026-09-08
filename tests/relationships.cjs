// Browser integration tests use an isolated JSON file; the real family data is never edited.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../server.cjs');
const demo = require('../data/family.json');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'family-browser-test-'));
  const dataFile = path.join(directory, 'family.json');
  await fs.writeFile(dataFile, JSON.stringify(demo));
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('.person').length === 24);
    const layout = await page.evaluate(() => {
      const node = id => document.querySelector(`[data-person-id="${id}"]`);
      return { a: node('p24').getBoundingClientRect().top, b: node('p11').getBoundingClientRect().top, text: node('p11').innerText, gen: node('p24').closest('.generation').dataset.gen };
    });
    assert.equal(layout.a, layout.b); assert.equal(layout.gen, '3');
    assert.match(layout.text, /所在地：未填寫/); assert.match(layout.text, /職位：未填寫/); assert.match(layout.text, /手足序：1/);
    assert(!/1950|在世|生年/.test(layout.text));
    assert.equal(await page.locator('#tree-connectors [data-kind="契手足"]').count(), 1);
    assert.equal(await page.locator('#relationship-legend .legend__item').count(), 10);
    console.log('PASS peer-derived levels, location/position display and numeric ranks');

    const viewport = page.locator('.tree'), frame = await viewport.boundingBox();
    assert(frame.width > 1400 && frame.y + frame.height <= 1001);
    await viewport.evaluate(el => { el.scrollLeft = 250; el.scrollTop = 200; });
    const before = await viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
    await page.mouse.move(500, frame.y + 200); await page.mouse.down();
    await page.mouse.move(350, frame.y + 100, { steps: 8 }); await page.mouse.up();
    const after = await viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
    assert(after[0] > before[0] + 100 && after[1] > before[1] + 60);
    assert.equal(await page.locator('.person[aria-pressed="true"]').count(), 0);
    await page.selectOption('#family-filter', 'u5');
    await page.locator('[data-person-id="p17"]').click();
    const details = await page.locator('#relationship-details').innerText();
    assert.match(details, /長兄：陳志明/); assert.match(details, /三妹：陳雅雯/); assert.match(details, /五弟：陳冠廷/);
    assert.match(details, /師父：陳建國/);
    const geometry = await page.locator('#tree-connectors').evaluate(svg => {
      const points = role => [...svg.querySelector(`[data-role="${role}"]`).points].map(p => [p.x, p.y]);
      return { marriage: points('marriage'), stem: points('parent-stem'), bar: points('sibling-bar'), children: [...svg.querySelectorAll('[data-role="child"]')].map(el => [...el.points].map(p => [p.x, p.y])) };
    });
    assert.equal(geometry.stem[0][1], geometry.marriage[1][1]);
    assert.equal(geometry.stem[1][1], geometry.bar[0][1]);
    geometry.children.forEach(p => assert.equal(p[0][1], geometry.bar[0][1]));
    console.log('PASS panning, shared family connectors and numeric relationship titles');

    await page.locator('#add-member').click();
    await page.locator('#member-name').fill('瀏覽器測試成員');
    await page.locator('#member-location').fill('臺南市');
    await page.locator('#member-position').fill('工程師');
    await page.selectOption('#member-gender', 'F');
    await page.locator('#member-order').fill('2');
    async function relation(type, personId) {
      await page.locator('#add-relation').click();
      const row = page.locator('.relation-row').last();
      await row.locator('.relation-target').selectOption(personId);
      await row.locator('.relation-type').selectOption(type);
      return row;
    }
    await relation('parent', 'p11'); await relation('parent', 'p15'); await relation('teacher', 'p24');
    assert.match(await page.locator('.relation-preview').last().innerText(), /周文彥是瀏覽器測試成員的師父/);
    const beforeSave = await fs.readFile(dataFile, 'utf8');
    await page.locator('#save-member').click();
    await page.waitForFunction(() => document.getElementById('member-error').textContent.includes('次序重複'));
    assert.equal(await fs.readFile(dataFile, 'utf8'), beforeSave);
    assert.equal(await page.locator('#member-name').inputValue(), '瀏覽器測試成員');
    assert.equal(await page.locator('.relation-row').count(), 3);
    await page.locator('#member-order').fill('7');
    await page.locator('#save-member').click();
    await page.waitForFunction(() => !document.getElementById('member-dialog').open);
    const disk = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    const added = disk.people.find(p => p.name === '瀏覽器測試成員');
    assert(added); assert.equal(added.siblingOrder, 7); assert.equal(added.relationships.length, 3); assert.equal(added.location, '臺南市'); assert.equal(added.position, '工程師');
    assert.equal(await page.locator('.person').count(), 25);
    assert.match(await page.locator('#relationship-details').innerText(), /師父：周文彥/);
    assert.match(await page.locator('#relationship-details').innerText(), /親生關係的父母：陳建國、吳雅婷/);
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.person').length === 25);
    assert.match(await page.locator(`[data-person-id="${added.id}"]`).innerText(), /臺南市/);
    const nodeGen = await page.locator(`[data-person-id="${added.id}"]`).evaluate(n => n.closest('.generation').dataset.gen);
    assert.equal(nodeGen, '4');
    console.log('PASS form validation, preserved input, multiple relations, disk persistence and reload');

    await page.locator('#add-member').click(); await page.locator('#member-name').fill('取消不儲存');
    await relation('spouse', 'p24'); await page.locator('.remove-relation').click();
    assert.equal(await page.locator('.relation-row').count(), 0);
    await page.locator('#cancel-member').click();
    assert.equal(JSON.parse(await fs.readFile(dataFile, 'utf8')).people.length, 25);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(220);
    await page.locator('#add-member').click();
    const modal = await page.locator('#member-dialog').boundingBox();
    assert(modal.x >= 0 && modal.width <= 390 && modal.y >= 0 && modal.height <= 844);
    await page.locator('#member-name').fill('手機表單');
    await relation('swornSibling', 'p11');
    await page.locator('#cancel-member').click();
    const mobileFrame = await viewport.boundingBox();
    await viewport.evaluate(el => { el.scrollLeft = 200; el.scrollTop = 0; });
    const touchBefore = await viewport.evaluate(el => el.scrollLeft);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: mobileFrame.y + 100 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: mobileFrame.y + 100 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert((await viewport.evaluate(el => el.scrollLeft)) > touchBefore + 60);
    await cdp.detach();
    console.log('PASS cancel/removal, mobile form and touch dragging');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    await fs.unlink(dataFile); await fs.rmdir(directory);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
