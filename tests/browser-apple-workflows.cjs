// Exercise the search/navigation contract with isolated API and browser storage.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'family-apple-workflows-'));
  const fixture = await fs.readFile(path.join(__dirname,'../fixtures/family.json'),'utf8');
  const dataFile = path.join(directory,'family.json'); await fs.writeFile(dataFile,fixture);
  const output = path.resolve(process.env.PHASE5_OUTPUT_DIR || '.codebase-memory/phase5-results','apple-ui');
  await fs.mkdir(output,{recursive:true});
  const html = await renderFamilyTreeHtml({browserStorage:true,published:true});
  const server = createFamilyServer({dataFile});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const results = []; let browser, persistedBaseline;
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    for (const mode of ['api','static']) for (const [width,height] of [[1440,900],[1024,768],[390,844],[844,390],[320,740]]) {
      const compact = width <= 700 || (width <= 950 && height <= 520);
      const context = await browser.newContext({viewport:{width,height},hasTouch:compact,reducedMotion:'reduce'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org|nominatim\.openstreetmap\.org)\//,route => route.abort());
      await context.addInitScript(() => localStorage.setItem('family-tree:canvas-guide:v1','seen'));
      if (mode === 'static') {
        await context.route(base,route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'apple-ui-test'})),JSON.parse(fixture));
      }
      await page.goto(base); await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.querySelector('.person'));
      // The dev server canonicalizes JSON on first read. Freeze after that
      // initialization, then require every browsing flow to preserve its bytes.
      if (persistedBaseline === undefined) persistedBaseline = await fs.readFile(dataFile,'utf8');
      const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
      if (!compact) {
        await page.locator('.tree').focus(); await page.keyboard.press('Control+k');
      } else await page.locator('#show-member-list').click();
      assert(await page.locator('#member-list-search').evaluate(node => document.activeElement === node));
      await page.locator('#member-list-search').fill('不存在的成員xyz');
      assert(await page.locator('#member-list-empty').isVisible());
      await page.locator('#member-list-reset').click();
      assert.equal(await page.locator('#member-list-search').inputValue(),'');
      assert.equal(await page.locator('[data-member-filter=all]').getAttribute('aria-pressed'),'true');
      assert(await page.locator('#member-list-body tr').count() > 1);
      await page.keyboard.press('ArrowDown');
      assert(await page.locator('#member-list-body tr').first().evaluate(row => document.activeElement === row));
      await page.keyboard.press('ArrowDown');
      assert(await page.locator('#member-list-body tr').nth(1).evaluate(row => document.activeElement === row));
      await page.keyboard.press('Home'); await page.keyboard.press('ArrowUp');
      assert(await page.locator('#member-list-search').evaluate(node => document.activeElement === node));
      await page.keyboard.press('ArrowDown');
      const selected = await page.locator('#member-list-body tr').first().getAttribute('data-person-id');
      await page.keyboard.press('Enter'); await page.locator('#relationship-details').waitFor({state:'visible'});
      if (!compact) {
        assert.equal(await page.locator('#member-list-body tr[aria-current=true]').getAttribute('data-person-id'),selected);
        if (width === 1440 && mode === 'api') await page.screenshot({path:path.join(output,'desktop.png')});
        await page.locator('#close-member-list').click();
      } else if (width === 390 && mode === 'api') await page.screenshot({path:path.join(output,'mobile.png')});
      await page.locator('.details-close').click();
      await page.locator('#add-member').click();
      await page.locator('#member-name').focus(); await page.keyboard.press('Control+k');
      assert(await page.locator('#member-dialog').isVisible());
      assert.equal(await page.locator('#member-list-dialog').isVisible(),false,'Search shortcut leaves active forms alone');
      await page.locator('#cancel-member').click();

      const more = page.locator(compact ? (width > height ? '#landscape-more-open' : '#portrait-more-open') : '#desktop-more-open');
      await more.click();
      const menu = page.locator('#landscape-more-sheet'), search = menu.locator('.workspace-menu-search');
      if (compact) assert.equal(await search.evaluate(node => document.activeElement === node),false,'Mobile More does not summon keyboard');
      else assert(await search.evaluate(node => document.activeElement === node));
      const firstGroup = menu.locator('.workspace-menu-group').first();
      await firstGroup.locator('summary').click();
      assert.equal(await firstGroup.evaluate(node => node.open),false);
      await search.fill('族譜');
      assert.equal(await firstGroup.evaluate(node => node.open),true);
      await search.fill('xyz找不到功能');
      assert(await menu.locator('.workspace-menu-empty').isVisible());
      await menu.getByRole('button',{name:'顯示全部功能'}).click();
      assert.equal(await firstGroup.evaluate(node => node.open),false,'Search restores the previous disclosure state');
      await firstGroup.locator('summary').click();
      await search.focus(); await page.keyboard.press('ArrowDown');
      assert(await menu.locator('[data-action=relationship]').evaluate(node => document.activeElement === node));
      await page.keyboard.press('ArrowUp');
      assert(await search.evaluate(node => document.activeElement === node));
      await page.keyboard.press('Escape');
      assert(await more.evaluate(node => document.activeElement === node));

      const overflowing = await page.locator('.page-header,.workspace-toolbar').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.className));
      assert.deepEqual(overflowing,[],'Global navigation fits the viewport');
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)),original);
      assert.equal(await fs.readFile(dataFile,'utf8'),persistedBaseline);
      assert.deepEqual(errors,[]);
      results.push({mode,width,height,status:'passed'}); console.log(`PASS: Apple workflows ${mode} ${width}×${height}`);
      await context.close();
    }
    assert.equal(await fs.readFile(path.join(__dirname,'../fixtures/family.json'),'utf8'),fixture,'Source fixture remains unchanged');
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({results,fixtureUnchanged:true,realDevices:'not_run',actualOAuth:'not_run'},null,2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error);process.exitCode = 1;});
