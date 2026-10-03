// Exercises personal corrections using mocked Nominatim/tile responses, with no live service traffic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { build } = require('../dev/build.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, extra = {}) => ({ id, name:id, location:'關帝廟', gender:'U', position:'', siblingOrder:null, relationships:[], ...extra });
const automatic = { provider:'nominatim', query:'關帝廟', checkedAt:1, status:'resolved', lat:25.05, lon:121.5, displayName:'另一座關帝廟, 臺北市', osmType:'way', osmId:'100' };
const choices = [
  { name:'關帝廟', display_name:'關帝廟, 臺北市', lat:'25.05', lon:'121.5', osm_type:'way', osm_id:100 },
  { name:'新竹關帝廟', display_name:'新竹關帝廟, 東區, 新竹市', lat:'24.8028082', lon:'120.9665544', osm_type:'way', osm_id:200 }
];
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-location-corrections-'));
  await build(dir);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!pathname.startsWith('/repo/')) throw new Error('outside');
      const file = path.join(dir, pathname.slice(6) || 'index.html');
      res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const context = await browser.newContext({ viewport:{ width:1280, height:900 } });
    const requests = [], errors = [];
    let fail = true;
    await context.route('https://nominatim.openstreetmap.org/**', async route => {
      requests.push(new URL(route.request().url()).searchParams.get('q'));
      if (fail) { fail = false; await route.fulfill({ status:503, body:'unavailable' }); }
      else await route.fulfill({ contentType:'application/json', body:JSON.stringify(requests.at(-1) === '查無地點' ? [] : choices) });
    });
    await context.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#68756b"/><path d="M0 40h256M0 170h256M80 0v256M210 0v256" stroke="#eee" stroke-width="12"/></svg>' }));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.clock.install();
    const url = `http://127.0.0.1:${server.address().port}/repo/`;
    await page.goto(url); await page.waitForFunction(() => window.FamilyLocationCorrection && FamilyApp.snapshot());
    const fixture = { schemaVersion:2, locationLookupDeviceId:'other-device', people:[
      person('A', { geocode:automatic }), person('B', { geocode:automatic }),
      person('C', { geocode:{ provider:'nominatim', query:'關帝廟', checkedAt:1, status:'not_found' } }), person('D', { mapHidden:true })
    ] };
    await page.locator('#import-file').setInputFiles({ name:'places.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(fixture)) });
    await page.click('#confirm-import'); await page.click('#show-member-map');
    assert.equal(await page.locator('#member-map-dialog [data-correct-person="D"]').count(), 0);
    await page.click('#member-map-dialog [data-correct-person="A"]');
    assert(await page.locator('#location-apply-related').isChecked(),'same-location correction defaults to applying to the group');
    assert.match(await page.locator('#location-apply-label').textContent(),/其他 2 位/);
    assert.match(await page.locator('#location-correction-current').textContent(), /臺北市/);
    await page.fill('#location-search-query', '新竹市關帝廟');
    await page.clock.runFor(100); assert.deepEqual(requests, [], 'typing never triggers autocomplete requests');
    await page.click('#location-search-submit'); await page.clock.runFor(100);
    await page.waitForFunction(() => document.querySelector('#location-search-status').textContent.includes('5 秒後'));
    await page.clock.runFor(4999); assert.equal(requests.length, 1);
    await page.clock.runFor(100); await page.waitForSelector('[data-candidate="1"]');
    assert.deepEqual(requests, ['新竹市關帝廟', '新竹市關帝廟']);
    await page.click('[data-candidate="1"]');
    await page.clock.runFor(500);
    assert.match(await page.locator('#location-selection-status').textContent(), /東區, 新竹市/);
    const preview = await page.locator('#location-correction-canvas').boundingBox();
    const chosenMarker = await page.locator('#location-correction-canvas').getByRole('button', { name:/^新竹關帝廟：/ }).boundingBox();
    assert(Math.abs(chosenMarker.x + chosenMarker.width / 2 - (preview.x + preview.width / 2)) < 3,
      'selecting a candidate centers its marker in the map: ' + JSON.stringify({ preview, chosenMarker }));
    await page.screenshot({ path:path.join(dir, 'correction-candidates.png'), animations:'disabled' });
    await page.click('#save-location-correction'); await page.waitForFunction(() => !document.querySelector('#location-correction-dialog').open);
    let data = await page.evaluate(() => FamilyApp.snapshot().data);
    assert.equal(data.people[0].location, '關帝廟');
    assert.equal(data.people[0].locationOverride.source, 'nominatim');
    assert.equal(data.people[0].locationOverride.query, '新竹市關帝廟');
    assert.equal(data.people[0].locationOverride.lat, 24.8028082);
    assert.equal(data.people[1].locationOverride.lat,24.8028082); assert.equal(data.people[1].geocode.lat, 25.05);
    assert.equal(data.people[2].locationOverride.lat,24.8028082,'unlocated same-location member receives the correction');
    assert.equal(data.people[3].locationOverride,undefined,'private member is excluded from the group correction');
    await page.waitForFunction(() => document.querySelectorAll('#member-map-dialog .member-map-marker').length === 1);
    assert.equal(await page.locator('#member-map-dialog .member-map-marker').textContent(),'3');
    assert.equal(await page.locator('#member-map-dialog .location-manual-badge').count(), 3);
    // A user correction participates in existing undo; automatic metadata does not overwrite it.
    await page.click('#close-member-map'); await page.click('#save-status .save-status__action');
    await page.waitForFunction(() => !FamilyApp.snapshot().data.people[0].locationOverride);
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().data.people.filter(p=>p.locationOverride).length),0,'one undo restores every member in the shared correction');
    await page.click('#show-member-map'); await page.click('#member-map-dialog [data-correct-person="A"]');
    await page.uncheck('#location-apply-related');
    await page.fill('#location-search-query', '新竹市關帝廟'); await page.click('#location-search-submit');
    await page.waitForSelector('[data-candidate="1"]'); assert.equal(requests.length, 2, 'candidate results use persistent cache');
    await page.click('[data-candidate="1"]'); await page.click('#save-location-correction');
    await page.waitForFunction(() => !document.querySelector('#location-correction-dialog').open);
    await page.evaluate(async () => {
      await FamilyApp.locationCommand({ type:'resetLocation', id:'A' });
      await FamilyApp.locationCommand({ type:'updateLocations', query:'關帝廟', result:{ provider:'nominatim', query:'關帝廟', checkedAt:2, status:'resolved', lat:25.1, lon:121.6, displayName:'錯誤地點', osmType:'way', osmId:'300' } });
    });
    assert.equal(await page.evaluate(() => FamilyLocation.effective(FamilyApp.snapshot().data.people[0]).lat), 24.8028082);
    await page.click('#member-map-dialog [data-correct-person="A"]');
    await page.uncheck('#location-apply-related');
    await page.fill('#location-search-query', '新竹市關帝廟'); await page.click('#location-search-submit');
    await page.waitForSelector('[data-candidate="1"]');
    // Switching from the search overview keeps the map, even before choosing a candidate.
    const overviewMap = await page.locator('#location-correction-canvas [role="group"][tabindex="0"]').evaluateHandle(el => el.firstElementChild);
    await page.click('#location-mode-map');
    assert(await page.evaluate(node => node === document.querySelector('#location-correction-canvas [role="group"][tabindex="0"]').firstElementChild, overviewMap));
    await page.click('#location-mode-search');
    assert(await page.evaluate(node => node === document.querySelector('#location-correction-canvas [role="group"][tabindex="0"]').firstElementChild, overviewMap));
    await overviewMap.dispose();
    await page.click('[data-candidate="1"]');
    const map = page.locator('#location-correction-canvas [role="group"][tabindex="0"]');
    await map.focus(); await map.press('+'); await map.press('+'); await map.press('ArrowRight');
    const dragBox = await page.locator('#location-correction-canvas').boundingBox();
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
    await page.mouse.down(); await page.mouse.move(dragBox.x + dragBox.width / 2 + 80, dragBox.y + dragBox.height / 2, { steps:5 }); await page.mouse.up();
    const focusedMap = await map.evaluateHandle(el => el.firstElementChild);
    const markerBefore = await page.locator('#location-correction-canvas').getByRole('button', { name:/^新竹關帝廟：/ }).boundingBox();
    // Do not advance the fake clock: the last drag's bounds callback is still pending.
    await page.click('#location-mode-map');
    assert(await page.evaluate(node => node === document.querySelector('#location-correction-canvas [role="group"][tabindex="0"]').firstElementChild, focusedMap),
      'switching to crosshair mode must preserve the map instance');
    await page.click('#location-mode-search');
    const markerAfter = await page.locator('#location-correction-canvas').getByRole('button', { name:/^新竹關帝廟：/ }).boundingBox();
    assert(Math.abs(markerBefore.x-markerAfter.x)<1&&Math.abs(markerBefore.y-markerAfter.y)<1,'switching back preserves the adjusted viewport');
    assert(await page.locator('#save-location-correction').isDisabled(),'returning to search requires a candidate selection');
    await page.click('#location-mode-map'); await focusedMap.dispose();
    await page.waitForSelector('.location-correction-crosshair');
    async function checkCrosshair() {
      const visual = await page.locator('.location-correction-crosshair').evaluate(el => {
        const box=el.getBoundingClientRect(), map=document.querySelector('#location-correction-canvas').getBoundingClientRect();
        const pointerEvents=getComputedStyle(el).pointerEvents, paths=[...el.querySelectorAll('path')];
        // Ignore pointer-events:none only for this hit-test, then restore dragging behavior.
        el.style.pointerEvents='auto';
        const top=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
        el.style.removeProperty('pointer-events');
        return {width:box.width,height:box.height,dx:box.x+box.width/2-map.x-map.width/2,dy:box.y+box.height/2-map.y-map.height/2,
          pointerEvents,onTop:top===el||el.contains(top),strokes:paths.map(path=>path.getAttribute('stroke'))};
      });
      assert.equal(visual.width,48);assert.equal(visual.height,48);
      assert(Math.abs(visual.dx)<1&&Math.abs(visual.dy)<1,'crosshair stays at the visible map center');
      assert(visual.onTop,'crosshair paints above map tiles');
      assert.equal(visual.pointerEvents,'none');assert.deepEqual(visual.strokes,['white','#b92332']);
      for (const id of ['location-mode-search','location-mode-map','location-search-submit','location-restore-auto','cancel-location-correction','save-location-correction']) {
        const button=page.locator('#'+id);
        assert.equal(await button.locator('svg').count(),1);assert.equal(await button.textContent(),'');
        assert(await button.getAttribute('aria-label'));
        if(await button.isVisible()){const box=await button.boundingBox();assert(box.width>=44&&box.height>=44);}
      }
      const footer=await page.locator('.location-correction-actions').boundingBox(), save=await page.locator('#save-location-correction').boundingBox(), cancel=await page.locator('#cancel-location-correction').boundingBox();
      assert(footer.x+footer.width-save.x-save.width<=25,'save icon stays at the footer right edge');
      assert(Math.abs(save.x-cancel.x-cancel.width-8)<1,'cancel and save icons stay together');
    }
    await checkCrosshair();
    await page.screenshot({ path:path.join(dir, 'correction-map-desktop.png'), animations:'disabled' });
    await page.setViewportSize({ width:390, height:844 });
    const mobile = await page.locator('#location-correction-dialog').boundingBox();
    assert(mobile.x >= 0 && mobile.y >= 0 && mobile.x + mobile.width <= 391 && mobile.y + mobile.height <= 845);
    assert(await page.locator('#location-correction-canvas').evaluate(el => el.getBoundingClientRect().height >= 140));
    await page.screenshot({ path:path.join(dir, 'correction-map-mobile.png'), animations:'disabled' });
    await checkCrosshair();
    await page.setViewportSize({ width:844, height:390 });
    await page.screenshot({ path:path.join(dir, 'correction-map-landscape.png'), animations:'disabled' });
    await checkCrosshair();
    const landscape = await page.locator('#location-correction-dialog').boundingBox();
    assert(landscape.x >= 0 && landscape.y >= 0 && landscape.x + landscape.width <= 845 && landscape.y + landscape.height <= 391);
    await page.click('#save-location-correction'); await page.waitForFunction(() => !document.querySelector('#location-correction-dialog').open);
    data = await page.evaluate(() => FamilyApp.snapshot().data);
    assert.equal(data.people[0].locationOverride.source, 'map'); assert.equal(data.people[0].locationOverride.osmId, undefined);
    assert.notEqual(data.people[0].locationOverride.lon, 120.9665544); assert.equal(requests.length, 2, 'moving the crosshair uses no geocoder');
    assert(Math.abs(data.people[0].locationOverride.lon - (120.9665544 + 180 / 2 ** 17 - 80 * 360 / (256 * 2 ** 17))) < 0.000001,
      'the saved point retains search-mode zoom and drag adjustments across mode switches, even before debounced bounds callbacks');
    await page.click('#close-member-map'); await page.setViewportSize({ width:1280, height:900 });
    await page.evaluate(() => window.editFamilyMember('A')); await page.fill('#member-name', '改名'); await page.click('#save-member');
    await page.waitForFunction(() => FamilyApp.snapshot().data.people[0].name === '改名');
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people[0].locationOverride.source), 'map');
    const exported = await page.evaluate(() => FamilyApp.exportData());
    await page.reload(); await page.waitForFunction(() => window.FamilyLocationCorrection && FamilyApp.snapshot()?.data.people[0].locationOverride);
    assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data.people[0].locationOverride), exported.people[0].locationOverride);
    await page.click('#show-member-map'); await page.click('#member-map-dialog [data-correct-person="A"]');
    await page.click('#location-restore-auto'); await page.waitForFunction(() => !document.querySelector('#location-correction-dialog').open);
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people[0].locationOverride), undefined);
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people[0].geocode), undefined);
    await page.click('#close-member-map'); await page.click('#save-status .save-status__action');
    await page.waitForFunction(() => FamilyApp.snapshot().data.people[0].locationOverride);
    // The member detail panel offers the same correction flow.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('familytreeselect', { detail:{ id:'A' } })));
    await page.click('.relationship-details__profile [data-correct-person="A"]');
    assert(await page.locator('#location-correction-dialog').evaluate(el => el.open)); await page.click('#cancel-location-correction');
    await page.evaluate(() => window.editFamilyMember('A')); await page.fill('#member-location', '新竹天公壇'); await page.click('#save-member');
    await page.waitForFunction(() => FamilyApp.snapshot().data.people[0].location === '新竹天公壇');
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people[0].locationOverride), undefined);
    // Import on another browser/device keeps personal positions and cannot bypass privacy exclusion.
    const secondContext = await browser.newContext();
    await secondContext.route('https://nominatim.openstreetmap.org/**', route => { throw new Error('unexpected lookup on the second device'); });
    await secondContext.route('https://tile.openstreetmap.org/**', route => route.abort());
    const second = await secondContext.newPage(); second.on('pageerror', e => errors.push(e.message));
    await second.goto(url); await second.waitForFunction(() => window.FamilyLocationCorrection && FamilyApp.snapshot());
    await second.locator('#import-file').setInputFiles({ name:'transfer.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(exported)) });
    await second.click('#confirm-import'); await second.click('#show-member-map');
    assert.deepEqual(await second.evaluate(() => FamilyLocation.effective(FamilyApp.snapshot().data.people[0])), exported.people[0].locationOverride);
    await second.evaluate(() => FamilyLocationCorrection.open('D'));
    assert.equal(await second.locator('#location-correction-dialog').evaluate(el => el.open), false);
    await secondContext.close();
    // Negative results offer manual placement; private input is never sent, and closing cancels a queued query.
    await page.evaluate(() => FamilyLocationCorrection.open('C'));
    await page.fill('#location-search-query', '查無地點'); await page.click('#location-search-submit');
    await page.clock.runFor(15000);
    await page.waitForFunction(() => document.querySelector('#location-search-status').textContent.includes('查無地點'));
    assert.equal(await page.locator('.location-candidate').count(), 0); assert(await page.locator('#save-location-correction').isDisabled());
    const count = requests.length;
    await page.fill('#location-search-query', '私人住址'); await page.click('#location-search-submit');
    await page.waitForFunction(() => document.querySelector('#location-correction-error').textContent.includes('私人住址'));
    assert.equal(requests.length, count);
    await page.evaluate(() => localStorage.setItem('family-tree:nominatim-next-request', String(Date.now() + 15000)));
    await page.fill('#location-search-query', '取消的地點'); await page.click('#location-search-submit');
    await page.waitForFunction(() => document.querySelector('#location-search-status').textContent.includes('等待查詢間隔'));
    await page.click('#cancel-location-correction'); await page.clock.runFor(30000);
    assert.equal(requests.length, count, 'closing cancels queued requests and retries');
    assert.deepEqual(errors, []);
    console.log('Correction browser checks passed (candidates, 5-second retry, cache, crosshair, personal scope, undo, persistence, import and mobile layouts). Screenshots: ' + dir);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
