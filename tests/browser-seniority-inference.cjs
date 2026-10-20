// Run with node tests/browser-seniority-inference.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const p = (id, relationships = []) => ({ id,name:id,gender:'M',location:'',position:'',siblingOrder:null,relationships });
const r = (type,personId,seniority) => ({ type,personId,...(seniority ? {seniority} : {}) });
const fixture = type => ({ schemaVersion:3,familyName:'長幼推導測試',people:[
  p('A',[r('sibling','B','younger'),r(type,'C','older'),r(type,'D','younger')]),p('B'),p('C'),p('D')
] });
const source = data => ({ ...data,people:data.people.map(({inferredRelationships,...person}) => person) });

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-seniority-'));
  const dataFile = path.join(dir,'family.json'), server = createFamilyServer({dataFile});
  let browser;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of ['api','static']) for (const width of [1280,390]) {
      const initial = fixture('tangCousin');
      await fs.writeFile(dataFile,JSON.stringify(initial));
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      context.setDefaultTimeout(15_000);
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({browserStorage:true});
        await context.route(base+'/',route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => {
          if (!localStorage.getItem('seniority-test-seeded')) {
            localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'old-family'}));
            localStorage.setItem('seniority-test-seeded','true');
          }
        },initial);
      }
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      const ready = () => page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.find(p => p.id === 'C')?.inferredRelationships?.some(r => r.personId === 'B'));
      const select = async id => {
        await page.evaluate(id => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id}})),id);
        if (await page.locator('.relationship-details__tab').isVisible()) await page.locator('.relationship-details__tab').click();
        await page.locator('#relationship-details [data-group="cousins"]').evaluate(node => {node.open = true;});
        return page.locator('#relationship-details [data-group="cousins"] .relationship-entry').filter({has:page.locator('button.relationship-entry__person[data-person-id="B"]')});
      };
      const query = async (target,base) => {
        await page.evaluate(([target,base]) => {
          for (const [id,value] of [['relationship-a',target],['relationship-b',base]]) {
            const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change',{bubbles:true}));
          }
        },[target,base]);
        await page.waitForFunction(() => !document.querySelector('#relationship-search [type="submit"]').disabled);
        await page.locator('#relationship-search').evaluate(form => form.requestSubmit());
      };
      await page.goto(base); await ready();
      for (const [type,prefix] of [['tangCousin','堂'],['biaoCousin','表']]) {
        if (type === 'biaoCousin') await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),fixture(type));
        await ready();
        const snapshot = await page.evaluate(() => FamilyApp.snapshot());
        assert.deepEqual(source(snapshot.data),fixture(type),'backfill preserves manually recorded relationships');
        let entry = await select('C');
        assert.equal(await entry.locator('.relationship-entry__role').textContent(),prefix+'弟');
        assert.equal(await entry.locator('.relationship-missing').filter({hasText:'長幼'}).count(),0);
        await entry.locator('.relationship-entry__badge--inferred').first().click();
        const proof = page.locator('#relationship-proof-dialog');
        assert.match(await proof.textContent(),/比.*年幼|比.*年長/);
        assert.equal(await proof.locator('.evidence-missing').count(),0);
        await proof.getByRole('button',{name:'關閉關係依據'}).click();
        await page.locator('.details-close').click();
        entry = await select('D');
        assert.equal(await entry.locator('.relationship-entry__role').textContent(),prefix+'兄弟');
        assert.equal(await entry.locator('.relationship-missing').filter({hasText:'長幼未確認'}).count(),1);
        await page.locator('.details-close').click();
        await query('B','C');
        assert.match(await page.locator('#relationship-summary').textContent(),new RegExp('B 為 C 的'+prefix+'弟'));
        await page.getByRole('button',{name:'查看完整關係路徑'}).click();
        assert.match(await page.locator('#relationship-result-sheet').textContent(),/長幼依據/);
        await page.getByRole('button',{name:'關閉關係詳情'}).click();
        await page.locator('.relationship-result-end').click();
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot()),snapshot,'viewing relations never changes source or inferred data');
        await page.evaluate(() => {
          const snapshot = FamilyApp.snapshot(), member = snapshot.data.people.find(p => p.id === 'A');
          return FamilyApp.updateMember('A',{version:snapshot.version,member:{...member,relationships:member.relationships.map(relation => relation.personId === 'C' ? {...relation,seniority:'unknown'} : relation)}});
        });
        entry = await select('C');
        assert.equal(await entry.locator('.relationship-entry__role').textContent(),prefix+'兄弟');
        assert.equal(await entry.locator('.relationship-missing').filter({hasText:'長幼未確認'}).count(),1);
        await page.locator('.details-close').click();
        await page.reload(); await ready();
        assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'C').inferredRelationships.find(r => r.personId === 'B').seniority),undefined);
        await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
        entry = await select('C');
        assert.equal(await entry.locator('.relationship-entry__role').textContent(),prefix+'弟');
        await page.locator('.details-close').click();
      }
      // An age proof can include people who are not on the primary kinship path.
      const external = {schemaVersion:3,people:[p('A',[r('sibling','B'),r('tangCousin','C')]),p('B',[r('biaoCousin','X','older')]),p('X',[r('tangCousin','C','older')]),p('C')]};
      await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),external);
      await query('B','C');
      assert.match(await page.locator('#relationship-summary').textContent(),/B 為 C 的堂弟/);
      await page.getByRole('button',{name:'查看完整關係路徑'}).click();
      assert.match(await page.locator('#relationship-result-sheet').textContent(),/X比C年幼|C比X年長/);
      assert.equal(await page.locator('#relationship-result-sheet .evidence-missing').count(),0);
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log('PASS: known and ambiguous cousin seniority, tang/biao terminology, source evidence, external age paths, edit/reload/undo, and immutable source in API/static desktop/mobile');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
