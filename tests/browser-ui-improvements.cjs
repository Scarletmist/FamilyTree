// Regression coverage for coordinated canvas geometry and the revised UI flows.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium,webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');
const person = (id,name,relationships=[],extra={}) => ({id,name,gender:'M',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent = personId => ({type:'parent',personId,kind:'親生'});
const fixture = {schemaVersion:3,familyName:'同名人物與側欄的介面回歸測試',locationLookupDeviceId:'another-test-device',people:[
  person('g','祖父'),person('p','父親',[parent('g')]),person('m','母親',[],{gender:'F'}),
  person('a','同名成員',[parent('p'),parent('m')],{location:'新竹',notes:'保留者的完整備註\n' + '長備註內容。'.repeat(70)}),
  person('b','妹妹',[parent('p'),parent('m')],{gender:'F'}),person('dup','同名成員',[],{location:'臺北',notes:'併入者的資料'}),
  person('t','老師'),person('s','學生',[{type:'teacher',personId:'t'}])
],rankGroups:[{id:'rank',name:'家庭排行',type:'sibling',anchorId:'p',members:[{personId:'a',order:1},{personId:'b',order:2}]}]};
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function aligned(page,label) {
  await frames(page);
  const errors = await page.evaluate(() => {
    const canvas = document.getElementById('tree-canvas'), origin = canvas.getBoundingClientRect(), scale = origin.width / canvas.offsetWidth;
    const cards = [...canvas.querySelectorAll('.person')].map(node => { const r = node.getBoundingClientRect(); return {id:node.dataset.personId,left:(r.left-origin.left)/scale,right:(r.right-origin.left)/scale,bottom:(r.bottom-origin.top)/scale}; });
    return [...canvas.querySelectorAll('path[data-role=parent-origin]')].flatMap(line => {
      const [x,y] = line.dataset.points.split(' ')[0].split(',').map(Number);
      const ids = FamilyApp.graph().unions.find(u => u.id === line.dataset.union).partners;
      return cards.some(card => ids.includes(card.id) && x >= card.left-.6 && x <= card.right+.6 && Math.abs(y-card.bottom)<.6) ? [] : [{ids,x,y,cards}];
    });
  });
  assert.deepEqual(errors,[],label);
}
async function openGroups(page) { await page.evaluate(() => FamilyManagement.openGroups()); return page.locator('.rank-group-dialog'); }
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'family-ui-improvements-'));
  const file = path.join(temp,'family.json'); await fs.writeFile(file,JSON.stringify(fixture));
  const server = createFamilyServer({dataFile:file}); let browser;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`,html = await renderFamilyTreeHtml({browserStorage:true});
    const useWebKit = process.env.PLAYWRIGHT_ENGINE === 'webkit';
    browser = await (useWebKit ? webkit : chromium).launch({headless:true,...(useWebKit ? {} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of ['api','static']) for (const viewport of [{width:1440,height:1000},{width:390,height:844},{width:360,height:640},{width:844,height:390}]) {
      await fs.writeFile(file,JSON.stringify(fixture));
      const context = await browser.newContext({viewport,hasTouch:viewport.width<950,reducedMotion:'reduce'}),page = await context.newPage(),errors=[];
      page.on('pageerror',error => errors.push(error.message));
      if (mode === 'static') {
        await context.route(base+'/',route => route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data => localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'ui-test'})),fixture);
      }
      await context.addInitScript(() => localStorage.setItem('family-tree:canvas-guide:v1','seen'));
      await page.goto(base); await page.waitForFunction(() => FamilyApp?.snapshot?.() && document.querySelectorAll('.person').length >= 8);
      const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
      await aligned(page,'initial');
      await page.locator('#show-member-list').click(); await aligned(page,'left dock');
      if (viewport.width === 1440) {
        await page.evaluate(() => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'a'}})));
        await aligned(page,'both docks');
      }
      await page.locator('#close-member-list').click(); await aligned(page,'close left dock');
      await page.evaluate(() => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'a'}})));
      await aligned(page,'right dock');
      const actions = page.locator('.relationship-details__actions');
      assert(await actions.getByRole('button',{name:'新增同名成員的親屬',exact:true}).isVisible());
      assert(await actions.locator('.add-relative .details-action__label').isVisible());
      await page.locator('.relationship-category-nav button').filter({hasText:/^手足/}).first().click();
      assert(await page.locator('details[data-group=siblings]').evaluate(node => node.open));
      if (viewport.width < 950) {
        const nav = page.locator('.relationship-details__navigation');
        assert(await nav.getByText('完整閱讀',{exact:true}).isVisible());
        await nav.locator('.detail-expand').click(); await nav.locator('.detail-expand').click();
      }
      await page.evaluate(() => document.getElementById('tree-zoom-out').click()); await page.waitForTimeout(200);
      await aligned(page,'zoom with dock');
      if (!await page.locator('.details-collapse').isVisible()) await page.locator('.relationship-details__more-summary').click();
      await page.locator('.details-collapse').click(); await aligned(page,'collapsed dock');
      await page.locator('.relationship-details__tab').click(); await aligned(page,'reopened dock');
      await page.locator('.details-close').click(); await aligned(page,'closed dock');
      await page.evaluate(() => editFamilyMember('a'));
      assert.match(await page.locator('#member-relations').textContent(),/母親/);
      await page.locator('#cancel-member').click();
      await page.locator('#family-title').click(); assert.equal(await page.locator('#family-title-full').innerText(),fixture.familyName); await page.locator('.family-title-dialog button').click();

      const group = await openGroups(page);
      assert.equal(await group.getByRole('button',{name:'移除此群組'}).isVisible(),false);
      await group.locator('select[aria-label=編輯群組]').selectOption('rank');
      await group.locator('select[data-person-picker]').locator('..').locator('.select-trigger').click();
      await page.locator('.select-dropdown:popover-open .select-search').fill('父親');
      await page.locator('.select-dropdown:popover-open [role=option]').filter({hasText:/^父親（/}).click();
      assert.equal(await group.locator('.rank-selection-tools strong').innerText(),'已選 2 人');
      await group.getByLabel('只看已選成員').check();
      assert.equal(await group.locator('.rank-member:visible').count(),2);
      await group.locator('input[aria-label="同名成員的群組排行"]').first().fill('3');
      await group.locator('input[aria-label="妹妹的群組排行"]').fill('4');
      assert.match(await group.locator('.rank-selected-names').innerText(),/同名成員：3/);
      await group.getByRole('button',{name:'儲存群組'}).click();
      await page.waitForFunction(() => !document.querySelector('.rank-group-dialog') || document.querySelector('.rank-group-dialog .form-error')?.textContent);
      assert.equal(await page.locator('.rank-group-dialog .form-error').count() ? await page.locator('.rank-group-dialog .form-error').innerText() : '','');
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.rankGroups[0].members.find(m => m.personId === 'a').order),3);
      await page.evaluate(() => FamilyEditor.undo());

      await page.evaluate(() => FamilyManagement.openMerge({keepId:'a',removeId:'dup'}));
      const merge = page.locator('.family-management-dialog');
      assert(await merge.locator('select[data-person-picker]').first().locator('..').locator('.select-trigger').isVisible());
      assert(!await merge.locator('select[data-person-picker]').first().innerText().then(text => /・a）|ID：/.test(text)));
      assert.equal(await merge.locator('.merge-field').filter({has:page.getByRole('heading',{name:'姓名',exact:true})}).count(),0);
      assert.equal(await merge.locator('.merge-value-text').filter({hasText:'長備註內容。'}).innerText(),fixture.people[3].notes);
      assert(await merge.getByRole('button',{name:'確認合併'}).isDisabled());
      await merge.getByRole('button',{name:'預覽合併',exact:true}).click(); assert(await merge.getByRole('button',{name:'確認合併'}).isEnabled());
      const location = merge.locator('.merge-field').filter({has:page.getByRole('heading',{name:'所在地',exact:true})});
      await location.locator('input[value=remove]').check(); assert(await merge.getByRole('button',{name:'確認合併'}).isDisabled());
      await merge.getByRole('button',{name:'預覽合併',exact:true}).click(); await merge.getByRole('button',{name:'確認合併'}).click();
      await page.waitForFunction(() => !FamilyApp.snapshot().data.people.some(p => p.id === 'dup'));
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'a').location),'臺北');
      await page.evaluate(() => FamilyEditor.undo());
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)),original,'Undo restores the complete dataset');
      const diff = await page.evaluate(() => {
        const before = FamilyApp.snapshot().data,after = structuredClone(before),container = document.createElement('div'); document.body.append(container);
        after.rankGroups[0].members = after.rankGroups[0].members.filter(m => m.personId !== 'a');
        renderFamilyDifferences(container,before,after);
        const summary = container.innerText;
        container.querySelector('.family-diff-raw').open = true; const raw = container.innerText;
        container.remove(); return {summary,raw};
      });
      assert.match(diff.summary,/家庭排行/); assert.match(diff.summary,/同名成員：排行 1/); assert(!diff.summary.includes('anchorId')); assert(diff.raw.includes('anchorId'));

      await page.evaluate(() => document.getElementById('export-diagram').click());
      await page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      const output = page.locator('#tree-output-preview svg');
      const fullBox = await output.getAttribute('viewBox');
      await page.locator('#tree-output-page').selectOption('0'); assert.notEqual(await output.getAttribute('viewBox'),fullBox);
      await page.locator('#tree-output-page').selectOption('all'); assert.equal(await output.getAttribute('viewBox'),fullBox);
      const size = await output.boundingBox(); assert(size.width < viewport.width,'Fitted preview stays in the viewport');
      await page.locator('#tree-output-location').check(); assert(await page.locator('#tree-output-svg').isDisabled()); assert.match(await page.locator('#tree-output-dirty').innerText(),/請更新預覽/);
      await page.locator('#tree-output-generate').click(); await page.waitForFunction(() => !document.getElementById('tree-output-svg').disabled);
      await page.locator('#tree-output-dialog [data-close]').click();
      assert.deepEqual(errors,[]); await context.close();
      console.log(`PASS: UI workflows ${mode} ${viewport.width}×${viewport.height}`);
    }
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(temp,{recursive:true,force:true}); }
})().catch(error => { console.error(error);process.exitCode=1; });
