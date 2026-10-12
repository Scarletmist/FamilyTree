const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {build} = require('../dev/build.cjs');
const {mimeTypeFor} = require('../dev/site-source.cjs');
const {createFamilyServer} = require('../dev/server.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const p = (id,name,relationships = [],extra = {}) => ({id,name:('驗證_' + name).slice(0,80),gender:'U',location:'臺北',position:'職位',siblingOrder:null,relationships,...extra});
const parent = personId => ({type:'parent',personId,kind:'親生',source:'口述訪談 <原稿>',note:'資料說明：'.repeat(100)});
const fixture = () => ({schemaVersion:3,familyName:'導覽輸出驗證',people:[
  p('G','祖母'),p('P','封存母親',[parent('G')],{archive:{archivedAt:'2026-10-11T00:00:00Z'}}),
  p('Q','父親'),p('C','子女',[parent('P'),parent('Q')]),p('S','手足',[parent('P'),parent('Q')]),
  ...Array.from({length:5},(_,i) => p('N'+i,'成員'+i,[parent('C')])),
  p('L','完整長姓名測試'.repeat(12).slice(0,80),[parent('C')]),p('U','未連結'),
  p('Z','不銜接封存',[],{archive:{archivedAt:'2026-10-11T00:00:00Z'}})
],recycleBin:[{id:'deleted',person:p('deleted','回收成員'),deletedAt:'2026-10-11T00:00:00Z',incomingRelationships:[],groupReferences:[],ignoredPlans:[]}]});
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-phase4-')),out = process.env.PHASE4_OUTPUT_DIR || dir;
  let staticServer,apiServer,browser;
  const reports = [];
  try {
    await fs.mkdir(out,{recursive:true});await build(dir);
    staticServer = http.createServer(async (req,res) => {
      try {const url = new URL(req.url,'http://localhost');if (!url.pathname.startsWith('/repo/')) throw new Error('outside test');
        const file = path.join(dir,url.pathname.slice(6) || 'index.html');res.setHeader('Content-Type',mimeTypeFor(file));res.end(await fs.readFile(file));
      } catch {res.statusCode = 404;res.end('Not found');}
    });await new Promise(r => staticServer.listen(0,'127.0.0.1',r));
    const dataFile = path.join(dir,'api-family.json');await fs.writeFile(dataFile,JSON.stringify(fixture()));
    apiServer = createFamilyServer({dataFile});await new Promise(r => apiServer.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of process.env.PHASE4_QUICK ? ['static'] : ['static','api']) for (const [width,height] of process.env.PHASE4_QUICK ? [[1440,900]] : [[1440,900],[390,844],[360,640],[844,390]]) {
      const touch = width !== 1440,context = await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
      const page = await context.newPage(),errors = [];context.setDefaultTimeout(15000);page.on('pageerror',e => errors.push(e.message));
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org|nominatim\.openstreetmap\.org)\//,r => r.abort());
      const url = mode === 'static' ? `http://127.0.0.1:${staticServer.address().port}/repo/` : `http://127.0.0.1:${apiServer.address().port}/`;
      await page.goto(url);await page.waitForFunction(() => FamilyApp?.snapshot?.() && FamilyEditor && document.getElementById('kinship-status').textContent === '');
      await page.evaluate(async data => {await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version});await FamilyEditor.reload();},fixture());
      const select = id => page.evaluate(id => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id,options:{expandDetails:true}}})),id);
      const minimap = page.locator('#tree-minimap');
      if (touch) {assert(await minimap.isHidden());await page.evaluate(() => document.getElementById('toggle-tree-minimap').click());}
      await minimap.waitFor({state:'visible'});assert.equal(await minimap.locator('text').count(),0);
      if (mode === 'static') await page.screenshot({path:path.join(out,`phase4-navigation-${width}x${height}.png`)});
      const canvasContent = await page.locator('#tree-canvas').innerHTML();
      await page.evaluate(() => {window.mapMutations = 0;new MutationObserver(rows => mapMutations += rows.length).observe(document.querySelector('.tree-minimap__surface > g'),{subtree:true,childList:true,attributes:true});});
      const surface = minimap.locator('svg'),box = await surface.boundingBox();
      await page.mouse.click(box.x + box.width * .9,box.y + box.height * .75);await page.waitForTimeout(60);
      assert.equal(await page.evaluate(() => mapMutations),0,'panning changes only viewport/selection rects');
      assert.equal(await page.locator('#tree-canvas').innerHTML(),canvasContent,'map pan does not rebuild graph');
      const beforePan = await page.locator('.tree').evaluate(el => [el.scrollLeft,el.scrollTop]);
      await surface.focus();await page.keyboard.press('ArrowLeft');await page.waitForTimeout(60);
      const afterPan = await page.locator('.tree').evaluate(el => [el.scrollLeft,el.scrollTop]);assert.notDeepEqual(beforePan,afterPan);
      const frameBox = await minimap.locator('.tree-minimap__viewport').boundingBox();
      if (frameBox && frameBox.width > 4 && frameBox.height > 4) {
        const beforeDrag = await page.locator('.tree').evaluate(el => [el.scrollLeft,el.scrollTop]);
        await page.mouse.move(frameBox.x + frameBox.width / 2,frameBox.y + frameBox.height / 2);await page.mouse.down();await page.mouse.move(frameBox.x + frameBox.width / 2 + 12,frameBox.y + frameBox.height / 2 + 12,{steps:5});await page.mouse.up();
        assert.notDeepEqual(await page.locator('.tree').evaluate(el => [el.scrollLeft,el.scrollTop]),beforeDrag,'dragging viewport moves camera');
      }
      await select('C');await page.waitForTimeout(120);
      if (await minimap.isVisible()) {
        const boxes = await page.evaluate(() => {const map = document.getElementById('tree-minimap').getBoundingClientRect(),panel = document.getElementById('relationship-details').getBoundingClientRect();return {map:{left:map.left,right:map.right,top:map.top,bottom:map.bottom},panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom}};});
        assert(boxes.map.right <= boxes.panel.left + 2 || boxes.map.bottom <= boxes.panel.top + 2 || boxes.map.top >= boxes.panel.bottom - 2,JSON.stringify(boxes));
      }
      if (mode === 'static') await page.screenshot({path:path.join(out,`phase4-map-${width}x${height}.png`)});
      await page.evaluate(() => document.querySelector('.details-close').click());
      const openOutput = () => page.evaluate(() => document.getElementById('export-diagram').click());
      const ready = () => page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      await openOutput();await ready();assert(await minimap.isHidden());
      const initialVersion = await page.evaluate(() => FamilyApp.snapshot().version);
      assert.equal(await page.locator('.tree-export-stage').count(),0);
      assert.match(await page.locator('#tree-output-preview').textContent(),/銜接人物/);
      assert.doesNotMatch(await page.locator('#tree-output-preview').textContent(),/不銜接封存|回收成員|臺北|職位：/);
      await page.check('#tree-output-sources');assert(await page.locator('#tree-output-svg').isDisabled());await page.click('#tree-output-generate');await ready();
      const downloadEvent = page.waitForEvent('download');await page.click('#tree-output-svg');const download = await downloadEvent;
      const svgFile = path.join(out,`phase4-${mode}-${width}.svg`);await download.saveAs(svgFile);const svg = await fs.readFile(svgFile,'utf8');
      assert(svg.includes('口述訪談 &lt;原稿&gt;'));assert(svg.replace(/<[^>]+>/g,'').includes(fixture().people.find(p => p.id === 'L').name));
      assert(!svg.includes('foreignObject'));assert(!svg.includes('回收成員'));assert(!svg.includes('data-people'));
      const standalone = await context.newPage();await standalone.goto('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
      assert.equal(await standalone.evaluate(() => document.documentElement.localName),'svg');assert(await standalone.locator('marker').count());assert.match(await standalone.locator('text').first().textContent(),/導覽輸出驗證/);
      const overflowingNames = await standalone.evaluate(() => {
        const cards = [...document.querySelectorAll('rect[rx="10"]')].map(card => ({x:Number(card.getAttribute('x')),y:Number(card.getAttribute('y')),width:Number(card.getAttribute('width')),height:Number(card.getAttribute('height'))}));
        return [...document.querySelectorAll('text[font-weight="600"]')].filter(text => {
          const x = Number(text.getAttribute('x')),y = Number(text.getAttribute('y')),card = cards.filter(c => Math.abs(c.x + 12 - x) < .1 && c.y <= y).sort((a,b) => b.y - a.y)[0];
          if (!card) return false;const box = text.getBBox();return box.y + box.height > card.y + card.height - 4 || box.x + box.width > card.x + card.width - 4;
        }).map(text => text.textContent);
      });assert.deepEqual(overflowingNames,[],'every exported name line fits its card');await standalone.close();
      const popupPromise = page.waitForEvent('popup');await page.click('#tree-output-print');const popup = await popupPromise;await popup.waitForLoadState('domcontentloaded');
      assert(await popup.locator('.print-page').count() > 2);assert(await popup.locator('[href="#page-2"]').count());
      if (mode === 'static' && width === 1440) {
        await popup.emulateMedia({media:'print'});await popup.screenshot({path:path.join(out,'phase4-print-preview.png'),fullPage:true});
        if (process.env.PHASE4_PDF) await popup.pdf({path:process.env.PHASE4_PDF,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
      }
      await popup.close();
      if (mode === 'static') await page.screenshot({path:path.join(out,`phase4-output-${width}x${height}.png`)});
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().version),initialVersion,'output never changes data');
      const stalePopupEvent = page.waitForEvent('popup');await page.click('#tree-output-print');const stalePopup = await stalePopupEvent;await stalePopup.waitForLoadState();
      await page.evaluate(async () => {const member = structuredClone(FamilyApp.snapshot().data.people.find(p => p.id === 'U'));member.name = '更新未連結';await FamilyApp.updateMember('U',{version:FamilyApp.snapshot().version,member});await FamilyEditor.reload();});
      assert(await page.locator('#tree-output-svg').isDisabled());assert.match(await page.locator('#tree-output-status').textContent(),/資料已更新/);
      assert(await stalePopup.locator('#print-document').isDisabled());assert.equal(await stalePopup.locator('.print-page:visible').count(),0);
      await page.click('#tree-output-generate');await ready();assert(await stalePopup.locator('#print-document').isDisabled());await stalePopup.close();
      await page.click('#tree-output-dialog [data-close]');
      // All four paper/orientation previews are generated at full text density.
      if (mode === 'static' && width === 1440) {
        await openOutput();await ready();
        for (const paper of ['A4','A3']) for (const orientation of ['portrait','landscape']) {
          await page.selectOption('#tree-output-paper',paper);await page.selectOption('#tree-output-orientation',orientation);await page.click('#tree-output-generate');await ready();
          assert.match(await page.locator('#tree-output-preview').textContent(),/正文至少 12pt/);
        }
        await page.check('#tree-output-archived');await page.check('#tree-output-location');await page.check('#tree-output-position');await page.click('#tree-output-generate');await ready();
        const text = await page.locator('#tree-output-preview').textContent();assert(text.includes('不銜接封存'));assert(text.includes('所在地：臺北'));assert(text.includes('職位：職位'));
        await page.click('#tree-output-dialog [data-close]');
        await page.evaluate(() => {const graph = FamilyApp.graph(),union = graph.descents.find(d => d.child === 'N0').union,select = document.getElementById('family-filter');select.value = union;select.dispatchEvent(new Event('change',{bubbles:true}));});
        const count = await page.locator('#tree-canvas .person').count();await openOutput();await ready();await page.selectOption('#tree-output-scope','current');await page.click('#tree-output-generate');await ready();
        assert.equal(await page.locator('#tree-output-preview rect[rx="10"]').count(),count);
        await page.click('#tree-output-dialog [data-close]');await page.evaluate(() => {const select = document.getElementById('family-filter');select.value = '';select.dispatchEvent(new Event('change',{bubbles:true}));});
      }
      await page.evaluate(() => document.getElementById('toggle-canvas-names').click());
      await openOutput();await ready();
      const hidden = await page.locator('#tree-output-preview').innerHTML();
      for (const person of fixture().people) assert(!hidden.includes(person.name),'hidden-name SVG contains no names: ' + person.id);
      assert(!hidden.includes('導覽輸出驗證'));assert(!hidden.includes('口述訪談'));assert(!hidden.includes('臺北'));
      assert(await page.locator('#tree-output-sources').isDisabled());
      const hiddenPopupPromise = page.waitForEvent('popup');await page.click('#tree-output-print');const hiddenPopup = await hiddenPopupPromise;await hiddenPopup.waitForLoadState();
      const hiddenHTML = await hiddenPopup.content();for (const person of fixture().people) assert(!hiddenHTML.includes(person.name));await hiddenPopup.close();
      await page.click('#tree-output-dialog [data-close]');
      await page.evaluate(() => document.getElementById('toggle-canvas-names').click());
      // Selected comparison retains its intermediate members and returning to
      // all scopes leaves the selected diagram unchanged.
      await page.click('#mobile-search-open');
      assert.deepEqual(errors,[], 'errors before query');
      const optionIds = await page.locator('#relationship-a option').evaluateAll(nodes => nodes.map(n => n.value));assert(optionIds.includes('N0'),JSON.stringify({optionIds,snapshot:await page.evaluate(() => FamilyApp.snapshot().data.people.map(p => p.id))}));
      await page.locator('#relationship-a').selectOption('N0',{force:true});await page.locator('#relationship-b').selectOption('G',{force:true});await page.locator('#relationship-search [type=submit]').click();
      const queryIds = await page.locator('#tree-canvas .person').evaluateAll(nodes => nodes.map(n => n.dataset.personId));
      await openOutput();await ready();assert.equal(await page.locator('#tree-output-scope').inputValue(),'path');
      assert.equal(await page.locator('#tree-output-preview rect[rx="10"]').count(),queryIds.length);
      await page.click('#tree-output-dialog [data-close]');assert.deepEqual(await page.locator('#tree-canvas .person').evaluateAll(nodes => nodes.map(n => n.dataset.personId)),queryIds);
      await page.evaluate(() => document.getElementById('relationship-reset').click());
      if (mode === 'static' && width === 1440) {
        const performanceReport = await page.evaluate(async () => {
          const {createMinimapGeometry,updateMinimapViewport} = await import('./assets/family-tree-minimap.mjs');
          const {serializeSVG,paginateScene,printDocument} = await import('./assets/family-tree-output.mjs');
          const results = [];
          for (const count of [50,200,1000]) {
            const scene = {width:250 * 20,height:150 * Math.ceil(count / 20),bands:[],placeholders:[],nodes:Array.from({length:count},(_,i) => ({id:'test' + i,x:i % 20 * 250,y:Math.floor(i / 20) * 150,width:220,height:100,lines:[{text:'合成成員' + i,size:20,bold:true,color:'#302c27'}]})),shapes:Array.from({length:count - 1},(_,i) => ({tag:'path',attrs:{d:`M ${i % 20 * 250} ${Math.floor(i / 20) * 150} h 220`,stroke:'#59616c'}}))};
            const times = [];let children;
            for (let n = 0; n < 30; n++) {const start = performance.now(),fragment = createMinimapGeometry(scene);times.push(performance.now() - start);children = fragment.childElementCount;}
            times.sort((a,b) => a - b);
            const frame = document.createElementNS('http://www.w3.org/2000/svg','rect'),start = performance.now();
            for (let n = 0; n < 1000; n++) updateMinimapViewport(frame,{x:n,y:n,width:600,height:400},scene);
            const framePerUpdate = (performance.now() - start) / 1000,outputStart = performance.now(),svg = serializeSVG(scene),pagination = paginateScene(scene),html = printDocument(scene,{}),outputMs = performance.now() - outputStart;
            results.push({count,geometryMedianMs:times[15],geometryP95Ms:times[28],framePerUpdateMs:framePerUpdate,children,outputMs,svgBytes:svg.length,printPages:pagination.pages.length,indexSheets:(html.match(/class="print-page print-index"/g) || []).length});
          }
          return results;
        });
        assert(performanceReport[2].children === 1000,'large minimap omits edges');
        await fs.writeFile(path.join(out,'phase4-performance.json'),JSON.stringify(performanceReport,null,2));
      }
      assert.deepEqual(errors,[]);reports.push({mode,width,height,queryIds,svgBytes:Buffer.byteLength(svg)});await context.close();
    }
    await fs.writeFile(path.join(out,'phase4-browser-report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify({checks:reports.length,output:out,reports},null,2));
  } finally {await browser?.close();if (staticServer) await new Promise(r => staticServer.close(r));if (apiServer) await new Promise(r => apiServer.close(r));}
})().catch(error => {console.error(error);process.exitCode = 1;});
