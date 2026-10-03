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
    const satelliteRequests=[];let failSatellite=false;
    await context.route(/^https:\/\/mt[0-3]\.google\.com\/vt\//,route=>{
      satelliteRequests.push(route.request().url());
      return route.fulfill(failSatellite ? {status:503,body:'unavailable'} : {contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#354d3e"/><path d="M0 40h256M80 0v256M190 0v256" stroke="#829580" stroke-width="10"/></svg>'});
    });
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
    await page.waitForSelector('.member-map-cluster');
    assert.equal(await page.locator('.member-map-marker').count(),1);
    assert.equal(await page.locator('.member-map-cluster').textContent(),'3','cluster counts members across both locations');
    assert.equal(await page.locator('.member-map-cluster').getAttribute('data-location-count'),'2');
    const canvas=page.locator('#member-map-canvas'), mapNode=await canvas.locator('[role="group"][tabindex="0"]').evaluateHandle(el=>el.firstElementChild);
    const mapBefore=await canvas.locator('.pigeon-tiles').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('style')));
    const dataVersion=await page.evaluate(()=>FamilyApp.snapshot().version);
    await canvas.getByRole('button',{name:'Google 衛星圖',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#member-map-canvas img')].some(img=>img.dataset.mapSource==='satellite'&&img.complete&&img.naturalWidth>0));
    assert(satelliteRequests.length>0);assert(satelliteRequests.every(url=>/^https:\/\/mt[0-3]\.google\.com\/vt\/lyrs=s&x=\d+&y=\d+&z=\d+$/.test(url)));
    assert(await page.evaluate(node=>node===document.querySelector('#member-map-canvas [role="group"][tabindex="0"]').firstElementChild,mapNode),'basemap changes preserve the map instance');
    assert.deepEqual(await canvas.locator('.pigeon-tiles').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('style'))),mapBefore,'switching preserves map pan and zoom');
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().version),dataVersion,'a basemap preference does not edit family data or history');
    assert.equal(await page.locator('.member-map-cluster').textContent(),'3');
    assert.match(await canvas.locator('.pigeon-attribution').textContent(),/Google Maps.*OpenStreetMap contributors/);
    assert.equal(await canvas.getByRole('button',{name:'Google 衛星圖',exact:true}).getAttribute('aria-pressed'),'true');
    const grouping=canvas.getByRole('button',{name:'合併鄰近地點',exact:true});
    assert.equal(await grouping.getAttribute('aria-pressed'),'true','nearby clustering defaults to enabled');
    await grouping.click();
    assert.equal(await grouping.getAttribute('aria-pressed'),'false');
    assert.equal(await canvas.locator('.member-map-cluster').count(),0);
    assert.equal(await canvas.locator('.member-map-marker').count(),2,'different coordinates are displayed separately');
    assert.equal(await canvas.getByRole('button',{name:'新竹天公壇：A、B',exact:true}).textContent(),'2','identical coordinates still share a counted marker');
    assert.equal(await canvas.getByRole('button',{name:'新竹關帝廟：C',exact:true}).textContent(),'●');
    assert(await page.evaluate(node=>node===document.querySelector('#member-map-canvas [role="group"][tabindex="0"]').firstElementChild,mapNode),'changing clustering preserves the map instance');
    assert.deepEqual(await canvas.locator('.pigeon-tiles').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('style'))),mapBefore,'changing clustering preserves pan and zoom');
    await canvas.getByRole('button',{name:'OpenStreetMap 街道圖',exact:true}).click();
    await canvas.getByRole('button',{name:'Google 衛星圖',exact:true}).click();
    assert.equal(await grouping.getAttribute('aria-pressed'),'false','basemap switching preserves the grouping choice');
    assert.equal(await page.evaluate(()=>FamilyApp.snapshot().version),dataVersion,'grouping does not edit family data');
    await grouping.click();
    assert.equal(await canvas.locator('.member-map-cluster').textContent(),'3','reenabling clustering merges nearby places');
    await mapNode.dispose();
    await page.screenshot({path:path.join(dir,'map-cluster.png'),animations:'disabled'});
    await page.click('.member-map-cluster');await page.clock.runFor(100);
    await page.waitForFunction(()=>document.querySelectorAll('.member-map-marker').length===2);
    assert.equal(await page.locator('.member-map-cluster').count(),0);
    await page.getByRole('button',{name:'縮小地圖',exact:true}).click();await page.clock.runFor(100);
    await page.getByRole('button',{name:'縮小地圖',exact:true}).click();await page.clock.runFor(100);
    await page.waitForSelector('.member-map-cluster');
    assert.equal(await page.locator('.member-map-cluster').textContent(),'3');
    await page.click('.member-map-cluster');await page.clock.runFor(100);
    await page.waitForFunction(()=>document.querySelectorAll('.member-map-marker').length===2);
    const correct=page.locator('#member-map-dialog [data-correct-person="A"]');
    assert.equal(await correct.locator('svg').count(),1);assert.equal(await correct.textContent(),'');
    assert.equal(await correct.getAttribute('aria-label'),'修正A的地點');
    assert.match(await page.locator('#member-map-status').textContent(),/3 位成員已定位/);
    assert.equal(await page.locator('.member-map-unlocated').count(),2);
    await page.screenshot({path:path.join(dir,'map-desktop.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await page.clock.runFor(100);
    const mobile=await page.locator('#member-map-dialog').boundingBox();
    assert(mobile.x>=0&&mobile.y>=0&&mobile.x+mobile.width<=391&&mobile.y+mobile.height<=845);
    for(const button of await canvas.locator('.member-map-basemaps button, .member-map-clustering button').all()){const box=await button.boundingBox();assert(box.width>=44&&box.height>=44);}
    await page.screenshot({path:path.join(dir,'map-mobile.png'),animations:'disabled'});
    await page.setViewportSize({width:844,height:390});
    await page.clock.runFor(100);
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
    await page.click('#show-member-map');await page.waitForSelector('#member-map-canvas img[data-map-source="satellite"]');
    assert.equal(await canvas.getByRole('button',{name:'Google 衛星圖',exact:true}).getAttribute('aria-pressed'),'true','basemap choice survives reload');
    await canvas.getByRole('button',{name:'OpenStreetMap 街道圖',exact:true}).click();
    await page.waitForSelector('#member-map-canvas img[data-map-source="osm"]');
    // Use a new zoom level so already decoded satellite images cannot mask a service outage.
    await canvas.getByRole('button',{name:'縮小地圖',exact:true}).click();await page.clock.runFor(100);
    failSatellite=true;
    await canvas.getByRole('button',{name:'Google 衛星圖',exact:true}).click();
    await page.waitForSelector('#member-map-canvas .member-map-tile-error');
    assert.match(await canvas.locator('.member-map-tile-error').textContent(),/載入失敗/);
    await canvas.getByRole('button',{name:'OpenStreetMap 街道圖',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#member-map-canvas .member-map-tile-error'));
    assert.equal(await canvas.locator('.pigeon-attribution a[href="https://www.google.com/maps"]').count(),0,'street map restores its own attribution');
    await page.click('#close-member-map');
    // Distinct places can remain within the clustering radius even at maximum zoom.
    await page.evaluate(async()=>{
      const {mount}=await import('./assets/vendor/pigeon-map.js');
      const host=document.createElement('div');host.id='max-zoom-map';host.style.cssText='position:fixed;inset:100px auto auto 100px;width:600px;height:400px;z-index:100';document.body.append(host);
      window.maxZoomMap=mount(host);
      maxZoomMap.update({focusKey:'nearby-fixture',groups:[
        {key:'near-a',lat:24.8,lon:120.96,label:'第一所在地',people:[{name:'甲'},{name:'乙'}]},
        {key:'near-b',lat:24.8,lon:120.96001,label:'第二所在地',people:[{name:'丙'}]}
      ]});
    });
    const nearMap=page.locator('#max-zoom-map'), nearCluster=nearMap.locator('.member-map-cluster');
    await nearCluster.waitFor();assert.match(await nearCluster.getAttribute('title'),/點選放大/);
    for(let i=0;i<6;i++){await nearMap.getByRole('button',{name:'放大地圖',exact:true}).click();await page.clock.runFor(100);}
    await nearCluster.hover();
    const maximumTitle=await nearCluster.getAttribute('title');
    assert.equal(maximumTitle,'此區域共 3 位成員\n第一所在地：甲、乙\n第二所在地：丙');
    assert.equal(await nearCluster.getAttribute('aria-label'),maximumTitle);
    const maximumView=await nearMap.locator('.pigeon-tiles').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('style')));
    await nearCluster.click();await page.clock.runFor(100);
    assert.deepEqual(await nearMap.locator('.pigeon-tiles').evaluateAll(nodes=>nodes.map(el=>el.getAttribute('style'))),maximumView,'maximum zoom cluster does not attempt to expand or recenter');
    await nearMap.getByRole('button',{name:'縮小地圖',exact:true}).click();await page.clock.runFor(100);
    assert.match(await nearCluster.getAttribute('title'),/點選放大/);
    await page.evaluate(()=>{maxZoomMap.destroy();delete window.maxZoomMap;document.querySelector('#max-zoom-map').remove();});
    // A second device waits for the owner, and can explicitly take over a pending place.
    const secondContext=await browser.newContext({viewport:{width:1024,height:768}});
    await secondContext.route('https://nominatim.openstreetmap.org/**',async route=>{
      const query=new URL(route.request().url()).searchParams.get('q');requests.push(query);
      await route.fulfill({contentType:'application/json',body:JSON.stringify(results(query))});
    });
    await secondContext.route('https://tile.openstreetmap.org/**',route=>route.abort());
    await secondContext.route(/^https:\/\/mt[0-3]\.google\.com\/vt\//,route=>route.abort());
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
