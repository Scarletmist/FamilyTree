const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {build} = require('../dev/build.cjs');
const {mimeTypeFor} = require('../dev/site-source.cjs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {complexFixture,performanceFixture} = require('./phase5-fixture.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-phase5-'));
  const out = path.resolve(process.env.PHASE5_OUTPUT_DIR || '.codebase-memory/phase5-results');
  let server,browser;
  try {
    await fs.mkdir(out,{recursive:true});await build(dir);
    server = http.createServer(async (req,res) => {
      try {
        const url = new URL(req.url,'http://localhost');
        if (!url.pathname.startsWith('/repo/')) throw new Error('Outside test');
        const file = path.resolve(dir,url.pathname.slice(6) || 'index.html');
        if (!file.startsWith(dir + path.sep)) throw new Error('Outside test');
        res.setHeader('Content-Type',mimeTypeFor(file));res.end(await fs.readFile(file));
      } catch {res.statusCode = 404;res.end('Not found');}
    });await new Promise(r => server.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const page = await context.newPage(),errors = [];context.setDefaultTimeout(45000);page.on('pageerror',e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/repo/`);
    await page.waitForFunction(() => FamilyApp?.snapshot?.() && FamilyEditor && document.getElementById('kinship-status').textContent === '');
    const performance = [];
    for (const size of [50,200,1000]) {
      let deadline;
      const metric = await Promise.race([page.evaluate(async data => {
        const start = performance.now();
        await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version});await FamilyEditor.reload();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const importAndRenderMs = performance.now() - start,buildTimes = [];
        for (let i = 0;i < 3;i++) {const t = performance.now();FamilyDisplayProjection.project(FamilyModel.build(data));buildTimes.push(performance.now() - t);}
        return {members:data.people.length,importAndRenderMs,modelProjectionMs:buildTimes,
          cards:document.querySelectorAll('.person').length,connectorPaths:document.querySelectorAll('#tree-connectors path').length,
          domElements:document.querySelectorAll('*').length,minimapSimplified:document.getElementById('tree-minimap').dataset.simplified};
      },performanceFixture(size)),new Promise((_,reject) => {deadline = setTimeout(() => reject(new Error(size + '-member import/render exceeded 90 seconds')),90000);})]).finally(() => clearTimeout(deadline));
      assert.equal(metric.cards,size);assert.equal(metric.minimapSimplified,String(size > 200));
      const before = await page.locator('#tree-canvas').innerHTML();
      const pan = await page.evaluate(async () => {const start = performance.now(),tree = document.querySelector('.tree');tree.scrollLeft += 200;await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));return performance.now() - start;});
      assert.equal(await page.locator('#tree-canvas').innerHTML(),before,'Pan must not rebuild the family');metric.panTwoFramesMs = pan;
      const outputStart = Date.now();await page.evaluate(() => document.getElementById('export-diagram').click());
      await page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      metric.outputPreviewMs = Date.now() - outputStart;
      assert.equal((await page.locator('#tree-output-preview svg text').allTextContents()).filter(text => /^效能成員\d+$/.test(text)).length,size);
      const printStart = Date.now(),printEvent = page.waitForEvent('popup');await page.click('#tree-output-print');const printView = await printEvent;await printView.waitForLoadState('domcontentloaded');
      metric.printViewMs = Date.now() - printStart;metric.printPages = await printView.locator('.print-page').count();await printView.close();
      await page.click('#tree-output-dialog [data-close]');performance.push(metric);console.log(JSON.stringify(metric));
      await fs.writeFile(path.join(out,'performance.json'),JSON.stringify({measurements:performance},null,2));
    }
    await fs.writeFile(path.join(out,'performance.json'),JSON.stringify({measuredAt:new Date().toISOString(),browser:await browser.version(),viewport:[1440,900],fixture:'Independent ten-person families',measurements:performance},null,2));
    await page.evaluate(async data => {await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version});await FamilyEditor.reload();},complexFixture());
    const exported = await page.evaluate(() => FamilyApp.exportData());
    await page.reload();await page.waitForFunction(() => FamilyApp?.snapshot?.());
    assert.deepEqual(await page.evaluate(() => FamilyApp.exportData()),exported,'Lifecycle and source metadata survive actual IndexedDB reload');
    await page.evaluate(async data => {const saved = await FamilyRepository.read();await FamilyRepository.replaceFromCloud(data,{fileId:'phase5',remoteVersion:'3'},saved.version);await FamilyEditor.reload();},exported);
    assert.deepEqual(await page.evaluate(() => FamilyApp.exportData()),exported,'Cloud JSON roundtrip preserves archive, recycle and legacy metadata');
    for (const [paper,orientation,hidden] of [['A4','landscape',false],['A3','portrait',false],['A4','portrait',true]]) {
      if (hidden) await page.evaluate(() => document.getElementById('toggle-canvas-names').click());
      await page.evaluate(() => document.getElementById('export-diagram').click());await page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      await page.selectOption('#tree-output-paper',paper);await page.selectOption('#tree-output-orientation',orientation);
      if (!hidden) await page.check('#tree-output-sources');
      await page.click('#tree-output-generate');await page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      const text = await page.locator('#tree-output-preview').textContent();
      assert.doesNotMatch(text,/單獨封存|回收成員/);
      if (hidden) assert.doesNotMatch(text,/封存銜接母親|第五階段測試訪談|完整長姓名/);else assert.match(text,/銜接人物/);
      const event = page.waitForEvent('popup');await page.click('#tree-output-print');const popup = await event;await popup.waitForLoadState('domcontentloaded');
      const name = `phase5-${paper}-${orientation}${hidden ? '-private' : ''}`;
      if (process.env.PHASE5_PDF) await popup.pdf({path:path.join(out,name+'.pdf'),preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
      await popup.close();await page.screenshot({path:path.join(out,name+'.png')});await page.click('#tree-output-dialog [data-close]');
    }
    assert.deepEqual(await page.evaluate(() => FamilyApp.exportData()),exported,'Navigation and output leave persisted data intact');
    for (const [width,height] of [[360,640],[390,844],[844,390]]) {
      const mobile = await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
      const phone = await mobile.newPage();phone.on('pageerror',e => errors.push(e.message));
      await phone.goto(`http://127.0.0.1:${server.address().port}/repo/`);await phone.waitForFunction(() => FamilyApp?.snapshot?.());
      await phone.evaluate(async data => {await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version});await FamilyEditor.reload();dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'U',options:{expandDetails:true}}}));},complexFixture());
      await phone.screenshot({path:path.join(out,`phase5-mobile-${width}x${height}.png`)});
      await phone.locator('.relationship-details__more-summary').click();
      assert(await phone.locator('.add-relative').isVisible());
      await phone.screenshot({path:path.join(out,`phase5-mobile-menu-${width}x${height}.png`)});await mobile.close();
    }
    assert.deepEqual(errors,[]);console.log('PASS phase 5: actual static pipeline, 50/200/1000 members, pan/preview, lifecycle cloud roundtrip, complex/hidden output.');
    await context.close();
  } finally {
    await browser?.close();if (server) await new Promise(r => server.close(r));
    if (path.dirname(dir) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test directory');
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(e => {console.error(e);process.exitCode = 1;});
