const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const person = (id, gender = 'M') => ({ id, name: id, gender, location: '', position: '', siblingOrder: null, relationships: [] });
const cases = [['叔父','M','paternal','younger','M'], ['伯父','M','paternal','older','M'], ['舅舅','M','maternal','unknown','F'], ['姑姑','F','paternal','unknown','M'], ['阿姨','F','maternal','unknown','F']];
async function checkGeometry(page) {
  const errors = await page.evaluate(() => {
    const canvas = document.getElementById('tree-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.person')].map(el => el.getBoundingClientRect());
    const segments = [...document.querySelectorAll('#tree-connectors path[data-role]')].flatMap(el => {
      const points = el.dataset.points.split(' ').map(pair => pair.split(',').map(Number));
      return points.slice(1).map((b,i) => [points[i],b]);
    });
    const errors = [];
    for (const [a,b] of segments) for (const card of cards) {
      const left = card.left - canvas.left, right = card.right - canvas.left, top = card.top - canvas.top, bottom = card.bottom - canvas.top;
      if (a[0] === b[0] ? a[0] > left + .5 && a[0] < right - .5 && Math.max(a[1],b[1]) > top + .5 && Math.min(a[1],b[1]) < bottom - .5
        : a[1] > top + .5 && a[1] < bottom - .5 && Math.max(a[0],b[0]) > left + .5 && Math.min(a[0],b[0]) < right - .5) errors.push('line overlaps member');
    }
    for (const button of document.querySelectorAll('.intermediate-node')) {
      const rect = button.getBoundingClientRect(), x = rect.left + rect.width / 2 - canvas.left, y = rect.top + rect.height / 2 - canvas.top;
      if (cards.some(card => rect.left < card.right && rect.right > card.left && rect.top < card.bottom && rect.bottom > card.top)) errors.push('plus overlaps member');
      if (!segments.some(([a,b]) => a[0] === b[0] ? Math.abs(x-a[0]) < 1 && y >= Math.min(a[1],b[1])-1 && y <= Math.max(a[1],b[1])+1 : Math.abs(y-a[1]) < 1 && x >= Math.min(a[0],b[0])-1 && x <= Math.max(a[0],b[0])+1)) errors.push('plus detached from connector');
    }
    return errors;
  });
  assert.deepEqual(errors, []);
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-avuncular-'));
  const dataFile = path.join(dir, 'family.json');
  const initial = {schemaVersion:3,people:[person('C','F'),person('R')]};
  await fs.writeFile(dataFile,JSON.stringify(initial));
  const server = createFamilyServer({dataFile});
  let browser;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
    for (const mode of ['api','static']) for (const [width,height] of [[1280,900],[390,844]]) {
      const context = await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
      context.setDefaultTimeout(15_000);
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({browserStorage:true});
        await context.route(base+'/',route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => {
          if (!localStorage.getItem('avuncular-test-seeded')) {
            localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'initial'}));
            localStorage.setItem('avuncular-test-seeded','true');
          }
        },initial);
      }
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.people.length >= 2);
      for (const [title,gender,lineage,seniority,parentGender] of cases) {
        await page.evaluate(async data => { await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}); await FamilyEditor.reload(); }, {...initial,people:[person('C','F'),person('R',gender)]});
        await page.evaluate(() => editFamilyMember('C'));
        await page.locator('#add-relation').click();
        const row = page.locator('.relation-row').last();
        await row.locator('.relation-target').selectOption('R');
        await row.locator('.relation-type').selectOption('uncleAunt');
        await row.locator('.relation-lineage').selectOption(lineage);
        await row.locator('.relation-cousin-seniority').selectOption(seniority);
        assert.match(await row.locator('.relation-preview').textContent(),new RegExp(`R是C的${title}`));
        await page.locator('#save-member').click();
        await page.waitForFunction(() => !document.getElementById('member-dialog').open || document.querySelector('#member-error')?.textContent);
        assert.equal(await page.locator('#member-error').textContent(),'');
        await page.waitForFunction(() => document.querySelector('.intermediate-node'));
        const plus = page.locator('.intermediate-node[data-plan-id^="叔伯姑姨舅|"]');
        assert.equal(await plus.count(),1,`${mode}/${width}/${title}: missing parent button`);
        await checkGeometry(page);
        if (process.env.AVUNCULAR_SCREENSHOTS && title === '伯父') await page.screenshot({path:path.join(process.env.AVUNCULAR_SCREENSHOTS,`${mode}-${width}-before.png`)});
        await plus.click();
        assert.equal(await page.locator('[name="gender"]').inputValue(),parentGender);
        assert.deepEqual(await page.locator('.relation-row').evaluateAll(rows => rows.map(row => row.querySelector('.relation-type').value)),['child','sibling']);
        await page.locator('#cancel-member').click();
        assert.equal(await plus.count(),1,'cancel retains placeholder');
        await page.evaluate(() => editFamilyMember('R'));
        assert.equal(await page.locator('.relation-type').inputValue(),'nephewNiece');
        assert.equal(await page.locator('.relation-lineage').inputValue(),lineage);
        assert.equal(await page.locator('.relation-cousin-seniority').inputValue(),seniority);
        await page.locator('#save-member').click();
        await page.waitForFunction(() => !document.getElementById('member-dialog').open);
        await plus.click();
        await page.locator('#member-name').fill('P');
        await page.locator('#save-member').click();
        await page.waitForFunction(() => FamilyApp.graph().people.length === 3 && !document.getElementById('member-dialog').open);
        assert.equal(await plus.count(),0);
        assert.equal(await page.locator('#tree-connectors path[data-kind="叔伯姑姨舅"]').count(),0,'completed branch uses parent/sibling connectors');
        await checkGeometry(page);
        await page.reload();
        await page.waitForFunction(() => FamilyApp?.graph?.()?.people.length === 3);
        assert.equal(await plus.count(),0,'completion survives reload');
        const source = await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'R').relationships.find(r => r.type === 'nephewNiece'));
        assert.equal(source.lineage,lineage);
        assert.equal(source.seniority || 'unknown',seniority);
        if (process.env.AVUNCULAR_SCREENSHOTS && title === '伯父') await page.screenshot({path:path.join(process.env.AVUNCULAR_SCREENSHOTS,`${mode}-${width}-after.png`)});
      }
      // Create a new relative from the older person's side of the same relation.
      await page.evaluate(async data => { await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}); await FamilyEditor.reload(); }, {...initial,people:[person('C','F')]});
      await page.locator('#add-member').click();
      await page.locator('#member-name').fill('新舅舅');
      await page.locator('#member-gender').selectOption('M');
      await page.locator('#add-relation').click();
      const newRow = page.locator('.relation-row');
      await newRow.locator('.relation-target').selectOption('C');
      await newRow.locator('.relation-type').selectOption('nephewNiece');
      await newRow.locator('.relation-lineage').selectOption('maternal');
      assert.match(await newRow.locator('.relation-preview').textContent(),/新舅舅是C的舅舅/);
      await page.locator('#save-member').click();
      await page.waitForFunction(() => FamilyApp.graph().people.length === 2 && !document.getElementById('member-dialog').open);
      const newPlus = page.locator('.intermediate-node[data-plan-id^="叔伯姑姨舅|"]');
      assert.equal(await newPlus.count(),1);
      await newPlus.click();
      await page.locator('.intermediate-ignore-button').click();
      await page.waitForFunction(() => !document.getElementById('member-dialog').open && !document.querySelector('.intermediate-node'));
      await page.evaluate(() => openIgnoredIntermediatePlans());
      await page.locator('.ignored-intermediate-item button').click();
      await page.locator('#close-ignored-intermediates').click();
      assert.equal(await newPlus.count(),1);
      await page.evaluate(async data => { await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}); await FamilyEditor.reload(); },
        {schemaVersion:3,people:[{...person('C','F'),relationships:[{type:'uncleAunt',personId:'R',lineage:'paternal',seniority:'older'},{type:'uncleAunt',personId:'A',lineage:'paternal'}]},person('R'),person('A','F')]});
      assert.equal(await newPlus.count(),1,'uncle and aunt share one missing father');
      await checkGeometry(page);
      await newPlus.click();
      assert.equal(await page.locator('.relation-row').count(),3,'shared father links child, uncle and aunt');
      await page.locator('#member-name').fill('共同父親');
      await page.locator('#save-member').click();
      await page.waitForFunction(() => FamilyApp.graph().people.length === 4 && !document.getElementById('member-dialog').open);
      assert.equal(await newPlus.count(),0);
      await checkGeometry(page);
      assert.deepEqual(errors,[]);
      console.log(`PASS ${mode}/${width}: all five relatives, reverse edit, cancel, plus completion, connector geometry, reload`);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    // Delete only this test's exact, verified temporary directory.
    assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
    assert(path.basename(dir).startsWith('family-avuncular-'));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
