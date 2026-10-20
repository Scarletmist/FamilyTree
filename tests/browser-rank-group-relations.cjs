const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const person = (id, gender = 'M', relationships = []) => ({ id, name:id, gender, relationships, siblingOrder:null, location:'', position:'' });
const group = (id, type, ids) => ({ id, name:id, type, members:ids.map((personId, index) => ({ personId, order:index + 1 })) });
const initial = { schemaVersion:3, familyName:'排行群組測試', people:[person('P'),
  ...['A','B','C'].map(id => person(id, id === 'B' ? 'F' : 'M', [{ type:'parent', personId:'P', kind:'親生' }])),
  person('D'), person('E','F'), person('F'), person('G','F'),
  person('H','M',[{ type:'swornSibling', personId:'I' }]), person('I','F')],
  rankGroups:[group('family','sibling',['A','B','C']), group('school','fellowDisciple',['F','G']), group('direct','swornSibling',['H','I'])] };

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-rank-groups-'));
  const dataFile = path.join(dir, 'family.json'), server = createFamilyServer({ dataFile });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const mode of ['api','static']) for (const [width,height] of [[1280,900],[390,844],[844,390]]) {
      await fs.writeFile(dataFile, JSON.stringify(initial));
      const context = await browser.newContext({ viewport:{width,height}, reducedMotion:'reduce', isMobile:width < 1000, hasTouch:width < 1000 });
      context.setDefaultTimeout(12_000);
      try {
        if (mode === 'static') {
          const html = await renderFamilyTreeHtml({ browserStorage:true });
          await context.route(base + '/', route => route.fulfill({ contentType:'text/html', body:html }));
          await context.addInitScript(data => {
            if (!localStorage.getItem('rank-test-seeded')) {
              localStorage.setItem('family-static-v1:/', JSON.stringify({ data, version:'rank-test' }));
              localStorage.setItem('rank-test-seeded','true');
            }
          }, initial);
        }
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.waitForFunction(() => window.FamilyApp?.graph()?.bonds.some(bond => bond.rankGroupIds));
        const groupLines = page.locator('#tree-connectors [data-details-only="true"]');
        const visible = async expected => {
          assert(await groupLines.count() > 0);
          assert(await groupLines.evaluateAll((nodes, shown) => nodes.every(node => (getComputedStyle(node).display !== 'none') === shown), expected));
        };
        await visible(false);
        assert(await page.locator('#tree-connectors path[data-kind="契手足"]:not([data-inferred])').count() > 0, 'direct relationships remain overview lines');

        // Save through the real group editor, then inspect the new derived link.
        await page.evaluate(() => FamilyManagement.openGroups());
        const editor = page.locator('.family-management-dialog');
        await editor.getByLabel('群組名稱',{exact:true}).fill('結拜排行');
        await editor.getByLabel('排行類型',{exact:true}).selectOption('swornSibling');
        for (const id of ['D','E']) await editor.getByRole('checkbox',{name:id,exact:true}).check();
        await editor.getByLabel('D的群組排行').fill('1');
        await editor.getByLabel('E的群組排行').fill('3');
        await editor.getByRole('button',{name:'儲存群組',exact:true}).click();
        await editor.waitFor({state:'hidden'});
        await page.waitForFunction(() => FamilyApp.graph().bonds.some(bond => bond.rankGroupIds && bond.members.includes('D')));
        const saved = await page.evaluate(() => FamilyApp.snapshot());
        await visible(false);
        await page.locator('.person[data-person-id="D"]').evaluate(node => node.click());
        await visible(true);
        const siblings = page.locator('#relationship-details [data-group="siblings"]');
        await siblings.evaluate(node => { node.open = true; });
        assert.match(await siblings.textContent(), /契三妹/);
        assert(await page.locator('#relationship-details .query-relationship').count() > 0);
        await siblings.locator('.relationship-entry__badge--inferred').click();
        const proof = page.locator('#relationship-proof-dialog');
        assert.match(await proof.textContent(), /排行群組：結拜排行/);
        assert.match(await proof.textContent(), /D：排行 1；E：排行 3/);
        assert.doesNotMatch(await proof.textContent(), /找不到.*原始記錄|尚無完整/);
        await proof.getByRole('button',{name:'關閉關係依據',exact:true}).click();
        await page.locator('#relationship-details .details-close').click();
        await visible(false);

        await page.locator(width > 700 ? height > 520 ? '#desktop-more-open' : '#landscape-more-open' : '#portrait-more-open').click();
        await page.locator('#toggle-inferred-lines').click();
        await page.locator('#landscape-more-close').click();
        await visible(false); // The overview toggle cannot expose group-only lines.
        await page.locator('.person[data-person-id="A"]').evaluate(node => node.click());
        await visible(true); // Includes shared strokes and endpoint markers.
        await page.locator('#relationship-details .details-close').click();
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot()), saved, 'viewing derived relationships never writes data');

        await page.evaluate(() => {
          for (const [id,value] of [['relationship-a','E'],['relationship-b','D']]) {
            const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change',{bubbles:true}));
          }
        });
        await page.waitForFunction(() => !document.querySelector('#relationship-search [type="submit"]').disabled);
        await page.locator('#relationship-search').evaluate(form => form.requestSubmit());
        await visible(true);
        assert.match(await page.locator('#relationship-summary').textContent(), /契三妹/);
        await page.locator('.relationship-result-end').click();
        await visible(false);
        await page.reload();
        await page.waitForFunction(() => window.FamilyApp?.graph()?.bonds.some(bond => bond.rankGroupIds));
        await visible(false);

        // Removing a member retracts its links; undo restores the group source.
        await page.evaluate(() => FamilyManagement.openGroups());
        const groupId = saved.data.rankGroups.find(group => group.name === '結拜排行').id;
        await editor.getByLabel('編輯群組',{exact:true}).selectOption(groupId);
        await editor.getByRole('checkbox',{name:'E',exact:true}).uncheck();
        await editor.getByRole('button',{name:'儲存群組',exact:true}).click();
        await editor.waitFor({state:'hidden'});
        assert.equal(await page.evaluate(() => FamilyApp.graph().bonds.some(bond => bond.rankGroupIds && bond.members.includes('D'))), false);
        await page.evaluate(() => FamilyEditor.undo());
        assert(await page.evaluate(() => FamilyApp.graph().bonds.some(bond => bond.rankGroupIds && bond.members.includes('D'))));
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data.people.map(person => person.relationships)), initial.people.map(person => person.relationships));
        assert.deepEqual(errors, []);
        console.log(`rank group relationships PASS ${mode} ${width}x${height}`);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
