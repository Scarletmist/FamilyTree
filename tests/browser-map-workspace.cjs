// Real modal, map and persistence interactions; all external services are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { build } = require('../dev/build.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, name, location, geocode, extra = {}) => ({ id, name, location, gender:'U', position:'', siblingOrder:null, relationships:[], geocode, ...extra });
const position = (query, lon) => ({ provider:'nominatim', query, status:'resolved', lat:24.8, lon, checkedAt:1, displayName:query + ', 新竹市', osmType:'way', osmId:'100' });
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-map-workspace-')); await build(dir);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/repo/')) throw new Error('outside');
      const file = path.join(dir, pathname.slice(6) || 'index.html');
      res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport:{ width:1280, height:900 } }), errors = [], requests = [];
    await context.route('https://nominatim.openstreetmap.org/**', route => { requests.push(route.request().url()); return route.fulfill({ contentType:'application/json', body:'[]' }); });
    await context.route(/^https:\/\/(tile\.openstreetmap\.org|mt[0-3]\.google\.com)\//, route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e1e8db"/><path d="M0 50h256M80 0v256" stroke="white" stroke-width="12"/></svg>' }));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}/repo/`); await page.waitForFunction(() => FamilyApp.snapshot() && window.FamilyMemberMap);
    const fixture = { schemaVersion:2, locationLookupDeviceId:'another-device', people:[
      person('A','陳建國','新竹天公壇',position('新竹天公壇',120.96)), person('B','陳淑芬','新竹天公壇',position('新竹天公壇',120.96)),
      person('C','陳志偉','新竹關帝廟',position('新竹關帝廟',120.96001)),
      person('P','陳惠美','城隍廟',{ provider:'nominatim', query:'城隍廟', checkedAt:1, status:'ambiguous' }),
      person('R','陳秀蓉','私人住址',undefined,{ mapHidden:true })
    ] };
    await page.locator('#import-file').setInputFiles({ name:'workspace.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(fixture)) }); await page.click('#confirm-import');
    await page.click('#show-member-map'); await page.waitForSelector('.member-map-cluster');
    const dialog = page.locator('#member-map-dialog'), canvas = page.locator('#member-map-canvas');
    let mapNode = await canvas.locator('[role="group"][tabindex="0"]').evaluateHandle(node => node.firstElementChild);
    async function sameMap() { assert(await page.evaluate(node => node === document.querySelector('#member-map-canvas [role="group"][tabindex="0"]').firstElementChild, mapNode), 'browse, selection and editing share one map instance'); }
    async function layers() { const toggle = dialog.getByRole('button',{ name:'底圖與群組設定', exact:true }); if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click(); }
    for (let index = 0; index < 6; index++) { await canvas.getByRole('button',{ name:'放大地圖', exact:true }).click(); await page.clock.runFor(100); }
    assert(await canvas.getByRole('button',{ name:'放大地圖', exact:true }).isDisabled());
    await canvas.locator('.member-map-cluster').click();
    assert.match(await canvas.locator('.member-map-cluster-popup').textContent(),/新竹天公壇.*陳建國.*陳淑芬.*新竹關帝廟.*陳志偉/);
    assert.equal(await page.locator('#member-map-list-title').textContent(),'這個區域');
    await layers(); await dialog.getByRole('button',{ name:'合併鄰近地點', exact:true }).click(); await page.keyboard.press('Escape');
    await page.locator('.member-map-place-heading').filter({ hasText:'新竹天公壇' }).click();
    assert.equal(await canvas.getByRole('button',{ name:'新竹天公壇：陳建國、陳淑芬', exact:true }).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.member-map-place.is-selected .member-map-place-heading').getAttribute('aria-pressed'),'true');
    await page.fill('#member-map-filter','陳建國');
    assert.equal(await page.locator('.member-map-place').count(),1);
    await page.click('[data-map-person="A"]'); assert.match(await page.locator('#member-map-person-summary').textContent(),/陳建國.*新竹天公壇.*自動定位/);
    await page.getByRole('button',{ name:'關閉成員摘要', exact:true }).click();
    assert.equal(await page.locator('[data-map-person="A"]').evaluate(node => node === document.activeElement),true);
    const anchor = () => canvas.getByRole('button',{ name:'新竹天公壇：陳建國、陳淑芬', exact:true }).evaluate(node => { const rect=node.parentElement.getBoundingClientRect(); return { x:rect.x, y:rect.y }; });
    const before = await anchor();
    await page.click('[data-correct-person="A"]'); await sameMap();
    assert.equal(await page.locator('dialog[open]').count(),1);
    assert.equal(await page.locator('#location-search-query').evaluate(node => node === document.activeElement),false);
    assert.match(await page.locator('#location-apply-summary').textContent(),/2 位/);
    await page.locator('#location-apply-scope summary').click(); assert.equal(await page.locator('#location-apply-members').textContent(),'陳建國、陳淑芬');
    await page.uncheck('#location-apply-related'); assert.equal(await page.locator('#location-apply-members').textContent(),'陳建國');
    await page.check('#location-apply-related');
    const map = canvas.locator('[role="group"][tabindex="0"]'); await map.focus(); await map.press('ArrowRight');
    await page.click('#member-map-back'); await page.clock.runFor(150); await sameMap();
    assert.equal(await page.inputValue('#member-map-filter'),'陳建國'); assert(await canvas.getByRole('button',{ name:'放大地圖', exact:true }).isDisabled());
    const after = await anchor(); assert(Math.abs(after.x-before.x)<1 && Math.abs(after.y-before.y)<1,'return restores the browse position and zoom: '+JSON.stringify({before,after}));
    await layers(); assert.equal(await dialog.getByRole('button',{ name:'合併鄰近地點', exact:true }).getAttribute('aria-pressed'),'false'); await page.keyboard.press('Escape');
    await page.click('[data-correct-person="A"]'); await map.focus(); await map.press('ArrowRight'); await page.click('#save-location-correction');
    await page.waitForFunction(() => document.querySelector('#member-map-dialog').dataset.editing !== 'true'); await sameMap();
    assert(await canvas.getByRole('button',{name:'放大地圖',exact:true}).isDisabled(),'saving retains the maximum zoom bound');
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people.filter(person => person.locationOverride).length),2);
    assert.match(await page.locator('#member-map-feedback').textContent(),/已更新 2 位成員/);
    await page.screenshot({ path:path.join(dir,'desktop-workspace.png'), animations:'disabled' });
    // Automatic metadata may advance the version; the inline undo still targets
    // the user correction and updates the existing editor's version as well.
    await page.evaluate(async () => { await FamilyApp.locationCommand({ type:'resetLocation', id:'C' }); });
    await page.locator('#member-map-feedback').getByRole('button',{ name:'復原', exact:true }).click();
    await page.waitForFunction(() => !FamilyApp.snapshot().data.people.some(person => person.locationOverride));
    assert.match(await page.locator('#member-map-feedback').textContent(),/已復原/);
    await page.click('#close-member-map');
    await page.evaluate(() => editFamilyMember('A')); await page.fill('#member-name','陳建國（更新）'); await page.click('#save-member');
    await page.waitForFunction(() => FamilyApp.snapshot().data.people[0].name === '陳建國（更新）');
    await page.setViewportSize({ width:390, height:844 }); await page.evaluate(() => FamilyMemberMap.open()); await page.waitForSelector('.member-map-cluster');
    await mapNode.dispose(); mapNode=await canvas.locator('[role="group"][tabindex="0"]').evaluateHandle(node=>node.firstElementChild);
    const panel = page.locator('#member-map-panel'), handle = page.locator('#member-map-sheet-handle');
    const medium = await panel.boundingBox(); await handle.click(); await page.clock.runFor(800);
    assert.equal(await panel.getAttribute('data-sheet-state'),'expanded'); assert((await panel.boundingBox()).height > medium.height);
    await layers(); const satellite = dialog.getByRole('button',{ name:'Google 衛星圖', exact:true });
    assert(await satellite.evaluate(node => { const box=node.getBoundingClientRect(); const top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2); return top === node || node.contains(top); }), 'layers remain accessible above an expanded sheet');
    const version = await page.evaluate(() => FamilyApp.snapshot().version); await satellite.click(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().version),version);
    await handle.focus(); await handle.press('ArrowDown'); assert.equal(await panel.getAttribute('data-sheet-state'),'collapsed');
    const collapsed = await panel.boundingBox(), grip = await handle.boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2); await page.mouse.down(); await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2-80,{ steps:4 });
    assert(Math.abs((await panel.boundingBox()).height-collapsed.height-80)<2,'the sheet tracks the pointer without a jump');
    await page.mouse.up(); await page.clock.runFor(800); await sameMap();
    await page.emulateMedia({ reducedMotion:'reduce' }); await handle.click();
    const state = await panel.getAttribute('data-sheet-state'); const reduced = await panel.boundingBox();
    await page.clock.runFor(100); assert(Math.abs((await panel.boundingBox()).height-reduced.height)<1,'reduced motion snaps directly to a stop'); assert(['collapsed','medium','expanded'].includes(state));
    await page.click('#member-map-status'); assert.equal(await page.locator('#member-map-list-title').textContent(),'尚未定位');
    assert.match(await page.locator('#member-map-list').textContent(),/陳惠美.*同名地點，需要確認/);
    await page.click('[data-correct-person="P"]'); assert.equal(await page.locator('#location-mode-search').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#save-location-correction').isDisabled()); assert.equal(await page.locator('#location-search-query').evaluate(node => node === document.activeElement),false);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#member-map-list-title').textContent(),'尚未定位');
    await page.click('#member-map-status'); await layers();
    if (await dialog.getByRole('button',{ name:'合併鄰近地點', exact:true }).getAttribute('aria-pressed') !== 'true') await dialog.getByRole('button',{ name:'合併鄰近地點', exact:true }).click();
    await page.keyboard.press('Escape');
    for (let index=0; index<6; index++) { await canvas.getByRole('button',{ name:'放大地圖', exact:true }).click(); await page.clock.runFor(100); }
    await canvas.locator('.member-map-cluster').click();
    assert.equal(await page.locator('#member-map-list-title').textContent(),'這個區域');
    assert.match(await page.locator('#member-map-list').textContent(),/新竹天公壇.*陳建國（更新）.*陳淑芬.*新竹關帝廟.*陳志偉/);
    assert.equal(await canvas.locator('.member-map-cluster-popup').isVisible(),false,'mobile shows region members in the sheet');
    await page.screenshot({ path:path.join(dir,'phone-region.png'), animations:'disabled' });
    await page.click('[data-map-person="A"]');
    await page.getByRole('button',{name:'查看陳建國（更新）的詳細資料',exact:true}).click();
    assert.equal(await page.locator('#relationship-details').getAttribute('data-collapsed'),'false','member summary opens full details on mobile');
    assert.deepEqual(requests,[],'browsing and manual correction do not issue geocoder requests'); assert.deepEqual(errors,[]);
    await mapNode.dispose();
    console.log('Map workspace checks passed (one map, selection, back, scope preview, inline undo, version rebasing, sheet drag, reduced motion, layers and mobile clusters). Screenshots: '+dir);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
