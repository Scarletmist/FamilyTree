// No live geocoder/tile traffic: verifies static deployment with deterministic service responses.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { build } = require('../dev/build.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const person = (id, location, extra = {}) => ({ id, name:id, location, gender:'U', position:'', siblingOrder:null, relationships:[], ...extra });
const results = query => [{ name:query, display_name:query + ', 新竹市', lat:query === '新竹關帝廟' ? '24.8028082' : '24.7995492', lon:query === '新竹關帝廟' ? '120.9665544' : '120.9586319', osm_type:'way', osm_id:query === '新竹關帝廟' ? 456 : 123 }];
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'family-locations-'));
  await build(dir);
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if (!pathname.startsWith('/repo/')) throw new Error('outside');
      const file=path.join(dir,pathname.slice(6)||'index.html');
      res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
      res.end(await fs.readFile(file));
    } catch {res.statusCode=404;res.end('missing');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    const requests=[], errors=[];
    let first=true;
    await context.route('https://nominatim.openstreetmap.org/**',async route=>{
      const url=new URL(route.request().url());const query=url.searchParams.get('q');requests.push(query);
      assert.equal(url.searchParams.has('name'),false);
      if (first) { first=false; await route.fulfill({status:503,body:'unavailable'}); }
      else await route.fulfill({contentType:'application/json',body:JSON.stringify(results(query))});
    });
    // Real tiles are only fetched by interactive users; test images keep regression runs offline.
    await context.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=','base64')}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();
    const url=`http://127.0.0.1:${server.address().port}/repo/`;
    await page.goto(url);await page.waitForFunction(()=>window.FamilyApp?.snapshot()&&window.FamilyMemberMap);
    await page.click('#add-member');await page.fill('#member-name','第一位');await page.fill('#member-location','新竹天公壇');await page.click('#save-member');
    await page.clock.runFor(100);
    await page.waitForFunction(()=>FamilyMemberLocations.state().kind==='retry');
    assert.deepEqual(requests,['新竹天公壇']);
    await page.clock.runFor(4999);assert.equal(requests.length,1);
    await page.clock.runFor(100);
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people[0]?.geocode?.status==='resolved');
    assert.deepEqual(requests,['新竹天公壇','新竹天公壇']);
    const initial=await page.evaluate(()=>FamilyApp.snapshot());
    assert.equal(initial.undoLabel,'新增成員「第一位」');
    await page.click('#show-member-map');await page.waitForSelector('.member-map-marker');
    assert.equal(await page.locator('.member-map-marker').count(),1);
    assert.match(await page.locator('#member-map-canvas').textContent(),/OpenStreetMap contributors/);
    await page.click('#close-member-map');
    // The original undo toast survives the later background coordinate/version write.
    await page.click('#save-status .save-status__action');
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people.length===0);

    // Existing/imported records are supplemented in the background; identical names use persistent cache.
    const fixture={schemaVersion:2,people:[person('A','新竹天公壇'),person('B','新竹天公壇'),person('C','新竹關帝廟'),person('D','新竹市中山路1號'),person('E','另一個私人地點',{mapHidden:true})]};
    await page.locator('#import-file').setInputFiles({name:'places.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await page.click('#confirm-import');
    await page.clock.runFor(15000);
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='B')?.geocode?.status==='resolved');
    assert.equal(requests.length,2,'persistent cache reuses the temple lookup');
    await page.clock.runFor(15000);
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='C')?.geocode?.status==='resolved');
    assert.equal(requests.length,3);assert.equal(requests[2],'新竹關帝廟');
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='D').geocode),undefined);
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='E').geocode),undefined);
    await page.click('#show-member-map');await page.waitForSelector('.member-map-marker');
    assert.equal(await page.locator('.member-map-marker').count(),2);
    assert.match(await page.locator('#member-map-status').textContent(),/3 位成員已定位/);
    assert.equal(await page.locator('.member-map-unlocated').count(),2);
    await page.screenshot({path:path.join(dir,'map-desktop.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.locator('#member-map-dialog').boundingBox();
    assert(mobile.x>=0&&mobile.y>=0&&mobile.x+mobile.width<=391&&mobile.y+mobile.height<=845);
    await page.screenshot({path:path.join(dir,'map-mobile.png'),animations:'disabled'});
    await page.setViewportSize({width:844,height:390});
    const landscape=await page.locator('#member-map-dialog').boundingBox();
    assert(landscape.x>=0&&landscape.y>=0&&landscape.x+landscape.width<=845&&landscape.y+landscape.height<=391);
    await page.screenshot({path:path.join(dir,'map-landscape.png'),animations:'disabled'});
    await page.click('#close-member-map');await page.setViewportSize({width:1280,height:900});

    // Coordinate-only writes rebase open forms without replacing their unsaved values or adding undo history.
    await page.evaluate(()=>window.editFamilyMember('B'));await page.fill('#member-name','保留中的修改');
    await page.evaluate(async()=>{
      const geocode=FamilyApp.snapshot().data.people.find(p=>p.id==='A').geocode;
      await FamilyApp.locationCommand({type:'resetLocation',id:'A'});
      await FamilyApp.locationCommand({type:'updateLocations',query:'新竹天公壇',result:geocode});
    });
    assert.equal(await page.inputValue('#member-name'),'保留中的修改');
    await page.click('#save-member');
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='B').name==='保留中的修改');
    await page.evaluate(()=>window.editFamilyMember('B'));await page.check('#member-map-hidden');await page.click('#save-member');
    await page.waitForFunction(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='B').mapHidden===true);
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='B').geocode),undefined);
    const exported=await page.evaluate(()=>FamilyApp.exportData());assert.equal(exported.people.find(p=>p.id==='A').geocode.lat,24.7995492);
    await page.reload();await page.waitForFunction(()=>FamilyApp.snapshot()?.data.people.find(p=>p.id==='C')?.geocode?.status==='resolved');
    await page.clock.runFor(15000);assert.equal(requests.length,3,'reload does not repeat completed/private queries');
    // A second device waits for the owner, and can explicitly take over a pending place.
    const secondContext=await browser.newContext({viewport:{width:1024,height:768}});
    await secondContext.route('https://nominatim.openstreetmap.org/**',async route=>{
      const query=new URL(route.request().url()).searchParams.get('q');requests.push(query);
      await route.fulfill({contentType:'application/json',body:JSON.stringify(results(query))});
    });
    await secondContext.route('https://tile.openstreetmap.org/**',route=>route.abort());
    const second=await secondContext.newPage();second.on('pageerror',e=>errors.push(e.message));await second.clock.install();
    await second.goto(url);await second.waitForFunction(()=>FamilyApp.snapshot()&&window.FamilyMemberMap);
    const transferred={...exported,people:[...exported.people,person('F','新竹市')]};
    await second.locator('#import-file').setInputFiles({name:'transfer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(transferred))});await second.click('#confirm-import');
    await second.clock.runFor(15000);assert.equal(requests.length,3);assert.equal(await second.evaluate(()=>FamilyMemberLocations.state().owner),false);
    await second.click('#show-member-map');await second.click('#member-map-takeover');await second.clock.runFor(100);
    await second.waitForFunction(()=>FamilyApp.snapshot().data.people.find(p=>p.id==='F').geocode?.status==='resolved');
    assert.equal(requests.length,4);assert.equal(requests[3],'新竹市');await secondContext.close();
    assert.deepEqual(errors,[]);
    console.log('Location browser checks passed (5-second retry, background, cache, privacy, static persistence, open forms, desktop/mobile). Screenshots: '+dir);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
