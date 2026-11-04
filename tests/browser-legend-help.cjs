const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'family-legend-help-'));
  const dataFile = path.join(temp,'family.json');
  await fs.copyFile(path.join(__dirname,'../fixtures/family.json'),dataFile);
  const out = path.resolve(process.env.LEGEND_HELP_OUTPUT || '.codebase-memory/phase5-results/legend-help');
  await fs.mkdir(out,{recursive:true});
  const server = createFamilyServer({dataFile}); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/`, html = await renderFamilyTreeHtml({browserStorage:true});
  const results = []; let browser;
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    for (const mode of ['api','static']) for (const [width,height] of [[1440,900],[1280,480],[1024,768],[390,844],[320,568],[844,390]]) {
      if (process.env.TEST_VIEWPORT && process.env.TEST_VIEWPORT !== `${width}x${height}`) continue;
      const compact = width <= 700 || (width <= 950 && height <= 520);
      const context = await browser.newContext({viewport:{width,height},hasTouch:compact,reducedMotion:'reduce'}), page = await context.newPage(), errors = [];
      context.setDefaultTimeout(8000); page.on('pageerror',e => errors.push(e.message));
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org|nominatim\.openstreetmap\.org)\//,route => route.abort());
      if (mode === 'static') {
        await context.route(base,route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'legend-help-test'})),JSON.parse(await fs.readFile(path.join(__dirname,'../fixtures/family.json'),'utf8')));
      }
      await page.goto(base); await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.querySelector('.person'));
      const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
      const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (!compact) {
        await page.locator('.legend-panel>summary').click(); await frames();
        const occluded = await page.locator('.legend-panel>.legend').evaluate(panel => {
          const r = panel.getBoundingClientRect(), points = [[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]];
          return points.flatMap(([x,y]) => {
            const top = document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);
            return top && panel.contains(top) ? [] : [{x,y,cover:top?.className,rect:r.toJSON()}];
          });
        });
        if (occluded.length) await page.screenshot({path:path.join(out,`${mode}-${width}x${height}-failure.png`)});
        assert.deepEqual(occluded,[],'Expanded legend must paint above the canvas');
        assert(await page.locator('.legend-panel>.legend').evaluate(el => {
          const r = el.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;
        }),'Legend stays inside the viewport');
        assert(await page.locator('.legend-panel>.legend').evaluate(panel => panel.scrollWidth <= panel.clientWidth),'Legend uses vertical scrolling without clipped columns');
        assert(await page.locator('.legend-panel>.legend').evaluate(panel => {
          panel.scrollTop = panel.scrollHeight;
          const last = panel.lastElementChild.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
          return last.top >= bounds.top && last.bottom <= bounds.bottom;
        }),'The final legend entry is reachable');
        await page.locator('.legend-panel>.legend').evaluate(panel => {panel.scrollTop = 0;});
        await page.screenshot({path:path.join(out,`${mode}-${width}x${height}-legend.png`)});
        await page.locator('.legend-panel>summary').click();
      }
      assert.equal(await page.locator('.canvas-guide:visible').count(),0,'Help does not occupy the canvas on a fresh visit');
      const more = page.locator(compact ? (width>height?'#landscape-more-open':'#portrait-more-open') : '#desktop-more-open');
      async function openHelp() {
        await more.click(); await page.locator('#landscape-more-sheet [data-action=guide]').click();
        await page.locator('#canvas-guide-dialog').waitFor({state:'visible'});
      }
      await openHelp();
      const guide = page.locator('#canvas-guide-dialog');
      assert(await guide.evaluate(el => el.matches(':modal')));
      assert.match(await guide.innerText(),/拖曳|雙指縮放/);
      assert(await guide.evaluate(el => {const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;}));
      await page.screenshot({path:path.join(out,`${mode}-${width}x${height}-help.png`)});
      await page.keyboard.press('Escape'); await guide.waitFor({state:'hidden'});
      assert(await more.evaluate(el => document.activeElement===el),'Closing help returns focus to More');
      await openHelp(); await guide.getByRole('button',{name:'知道了',exact:true}).click(); await guide.waitFor({state:'hidden'});
      await openHelp(); await guide.getByRole('button',{name:'定位人物',exact:true}).click();
      assert(await page.locator('#member-list-dialog').isVisible()); await page.locator('#close-member-list').click();
      await openHelp(); await guide.getByRole('button',{name:'看全圖',exact:true}).click(); await guide.waitFor({state:'hidden'});
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)),original,'Help actions preserve family data');
      await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.querySelector('.person'));
      assert.equal(await page.locator('.canvas-guide:visible').count(),0,'Help stays off the canvas after reload');
      assert.equal(await guide.isVisible(),false);
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)),original); assert.deepEqual(errors,[]);
      results.push({mode,width,height,status:'passed'}); console.log(`PASS legend/help ${mode} ${width}×${height}`);
      await context.close();
    }
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,physicalDevices:'not_run'},null,2));
  } finally {await browser?.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode=1;});
