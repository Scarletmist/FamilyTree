const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const p = (id, relationships = []) => ({id,name:id,gender:'U',location:'',position:'',siblingOrder:null,relationships});
const parent = personId => ({type:'parent',personId,kind:'親生'});
const initial = {schemaVersion:3,people:[p('G'),p('P',[parent('G')]),p('B',[parent('P')]),p('A')]};

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-acquaintances-'));
  const out = path.resolve(process.env.ACQUAINTANCE_OUTPUT_DIR || '.codebase-memory/acquaintances-results');
  await fs.mkdir(out,{recursive:true});
  const dataFile = path.join(dir,'family.json'), server = createFamilyServer({dataFile});
  let browser;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of ['api','static']) for (const width of [1280,390]) {
      await fs.writeFile(dataFile,JSON.stringify(initial));
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      page.setDefaultTimeout(10000);
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({browserStorage:true});
        await page.route(base + '/',route => route.fulfill({contentType:'text/html',body:html}));
        await page.addInitScript(data => localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'initial'})),initial);
      }
      await page.goto(base);
      await page.waitForFunction(() => window.FamilyApp?.graph()?.people.length === 4);
      await page.evaluate(() => editFamilyMember('A'));
      await page.click('#add-relation');
      await page.locator('.relation-target').selectOption('B',{force:true});
      await page.locator('.relation-type').selectOption('acquaintance',{force:true});
      assert.match(await page.locator('.relation-preview').textContent(),/A認識B/);
      assert.equal(await page.locator('.relation-kind').isVisible(),false);
      assert.equal(await page.locator('.relation-cousin-seniority').isVisible(),false);
      await page.click('#save-member');
      await page.waitForFunction(() => !document.getElementById('member-dialog').open);
      async function check(outside, generation) {
        await page.waitForFunction(({outside,generation}) => {
          const node = document.querySelector('.person[data-person-id="A"]');
          return node && (node.dataset.nonFamily === 'true') === outside
            && +node.closest('.generation').dataset.gen === generation;
        },{outside,generation});
        assert.equal(await page.locator('.person[data-person-id="A"]').evaluate(node => getComputedStyle(node).borderTopStyle),outside ? 'dashed' : 'solid');
        assert.equal(await page.locator('.person[data-person-id="B"]').evaluate(node => getComputedStyle(node).borderTopStyle),'solid');
      }
      await check(true,3);
      assert(await page.locator('.tree__connectors [data-kind="認識"]').count());
      assert.match(await page.locator('[data-group="acquaintances"]').textContent(),/B/);
      const svg = await page.evaluate(async () => {
        const {captureScene} = await import('/assets/family-tree-scene.mjs');
        const {serializeSVG} = await import('/assets/family-tree-output.mjs');
        return serializeSVG(captureScene(document.getElementById('tree-canvas')));
      });
      assert.match(svg,/stroke-dasharray="6 4"/);
      await fs.writeFile(path.join(out,`${mode}-${width}.svg`),svg);
      await page.screenshot({path:path.join(out,`${mode}-${width}.png`)});
      await page.reload(); await check(true,3);
      await page.evaluate(() => editFamilyMember('B'));
      assert.equal(await page.locator('.relation-type').filter({has:page.locator('option:checked[value="acquaintance"]')}).count(),1);
      await page.click('#save-member');
      await page.waitForFunction(() => !document.getElementById('member-dialog').open);
      await check(true,3);
      const snapshot = await page.evaluate(() => FamilyApp.snapshot());
      const a = snapshot.data.people.find(person => person.id === 'A');
      await page.evaluate(member => FamilyApp.updateMember('A',{member,version:FamilyApp.snapshot().version}),{...a,relationships:[...a.relationships,parent('G')]});
      await check(false,2);
      await page.reload(); await check(false,2);
      await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
      await check(true,3);
      // Direct application calls update the canvas; reopening a form uses the
      // editor's independently loaded version, so reload after this test setup.
      await page.reload(); await check(true,3);
      await page.click('#add-member');
      await page.fill('#member-name','新朋友');
      await page.click('#add-relation');
      await page.locator('.relation-target').selectOption('B',{force:true});
      await page.locator('.relation-type').selectOption('acquaintance',{force:true});
      await page.click('#save-member');
      await page.waitForFunction(() => !document.getElementById('member-dialog').open && FamilyApp.graph().people.length === 5).catch(async error => {
        console.error(await page.locator('#member-dialog').evaluate(dialog => ({
          text:dialog.textContent.slice(-600), invalid:[...dialog.querySelectorAll(':invalid')].map(control => ({name:control.name,value:control.value,validation:control.validationMessage}))
        })));
        throw error;
      });
      const newId = await page.evaluate(() => FamilyApp.graph().people.find(person => person.name === '新朋友').id);
      const newCard = page.locator(`.person[data-person-id="${newId}"]`);
      assert.equal(await newCard.getAttribute('data-non-family'),'true');
      assert.equal(await newCard.evaluate(node => +node.closest('.generation').dataset.gen),3);
      assert.equal(await newCard.evaluate(node => getComputedStyle(node).borderTopStyle),'dashed');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${mode} ${width}: create, edit, inverse edit, same row, dashed card, SVG, reload, family precedence, undo`);
      await context.close();
    }
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
