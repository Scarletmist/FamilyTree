const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { build } = require('../dev/build.cjs');
const { mimeTypeFor } = require('../dev/site-source.cjs');
const { createFamilyServer } = require('../dev/server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const p = (id,name,relationships = [],extra = {}) => ({id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent = (personId,status) => ({type:'parent',personId,kind:'親生',...(status ? {status} : {}),source:'訪談來源 ' + personId,note:'原始證據說明'});
const fixture = () => ({schemaVersion:3,familyName:'第三階段驗證',people:[
  p('G','祖母'),p('P','母親',[parent('G','confirmed')]),p('Q','父親'),p('C','子女',[parent('P','confirmed'),parent('Q')]),
  p('S','手足',[parent('P'),parent('Q')]),p('T','舊資料成員',[parent('P','pending')]),p('U','未連結'),
  p('L','長姓名測試'.repeat(16).slice(0,80),[parent('P')],{location:'所在地內容',notes:'長備註內容。'.repeat(200)}),
  p('I','待補祖孫',[{type:'grandparent',personId:'G',kind:'親生'}]),
  p('Z','封存成員',[parent('P')],{archive:{archivedAt:'2026-10-11T00:00:00Z'}})
]});
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-phase3-')); let staticServer,apiServer,browser;
  try {
    await build(dir);
    staticServer = http.createServer(async (req,res) => {
      try { const url = new URL(req.url,'http://localhost'); if (!url.pathname.startsWith('/repo/')) throw new Error('Outside test');
        const file = path.join(dir,url.pathname.slice(6) || 'index.html'); res.setHeader('Content-Type',mimeTypeFor(file)); res.end(await fs.readFile(file));
      } catch { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise(r => staticServer.listen(0,'127.0.0.1',r));
    const dataFile = path.join(dir,'api-family.json'); await fs.writeFile(dataFile,JSON.stringify(fixture()));
    apiServer = createFamilyServer({dataFile}); await new Promise(r => apiServer.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of ['static','api']) for (const [width,height] of [[1440,900],[390,844],[360,640],[844,390]]) {
      const touch = width !== 1440;
      const context = await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:'reduce'}); context.setDefaultTimeout(10000);
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org)\//,r => r.abort());
      await context.route('https://nominatim.openstreetmap.org/**',r => r.fulfill({json:[]}));
      const page = await context.newPage(),errors = []; page.on('pageerror',e => errors.push(e.message));
      const url = mode === 'static' ? `http://127.0.0.1:${staticServer.address().port}/repo/` : `http://127.0.0.1:${apiServer.address().port}/`;
      await page.goto(url); await page.waitForFunction(() => FamilyApp?.snapshot?.() && FamilyEditor && document.getElementById('kinship-status').textContent === '');
      await page.evaluate(async data => {await FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}); await FamilyEditor.reload();},fixture());
      const select = id => page.evaluate(id => dispatchEvent(new CustomEvent('familytreeselect',{detail:{id,options:{expandDetails:true}}})),id);
      const activate = locator => touch ? locator.tap() : locator.click();
      const proofClose = () => page.getByRole('button',{name:'關閉關係依據',exact:true}).click();
      await select('P');
      await page.locator('[data-group=children]').evaluate(el => el.open = true);
      await page.locator('.relationship-details__more-summary').click();
      await page.evaluate(() => FamilyApp.adopt(FamilyApp.snapshot(),'geocode'));
      assert(await page.locator('.relationship-details__more').evaluate(details => details.open),'Background redraw keeps the current member menu open');
      assert(await page.evaluate(() => document.activeElement.classList.contains('relationship-details__more-summary')),'Background redraw preserves menu keyboard focus');
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll('.relationship-details__more-body button')];
        return buttons.length > 0 && buttons.every(button => button.getBoundingClientRect().height >= 44);
      });
      const moreLayout = await page.evaluate(() => [...document.querySelectorAll('.relationship-details__more-body button')].map(button => {
        const box = button.getBoundingClientRect(),style = getComputedStyle(button),svg = button.querySelector('svg'),label = button.querySelector('.details-action__label');
        return {text:label?.textContent,icon:Boolean(svg),x:box.x,width:box.width,height:box.height,padding:style.padding,gap:style.gap,display:style.display,align:style.alignItems,justify:style.justifyContent};
      }));
      assert(moreLayout.every(button => button.icon && button.text && button.height >= 44),JSON.stringify(moreLayout));
      const reference = moreLayout[0];
      assert(moreLayout.every(button => button.x === reference.x && button.width === reference.width && button.padding === reference.padding && button.gap === reference.gap && button.justify === reference.justify),JSON.stringify(moreLayout));
      if (mode === 'static') await page.screenshot({path:path.join(dir,`more-${width}x${height}.png`)});
      await page.locator('.relationship-details__more-summary').click();
      const directEntry = page.locator('[data-group=children] .relationship-entry').filter({has:page.locator('[data-person-id=T]')});
      assert.equal(await page.locator('.relationship-source-button').count(),0);
      assert.equal(await directEntry.locator('.relationship-entry__badge--inferred').count(),0);
      assert(await directEntry.locator('.relationship-missing').count() > 0);
      await page.evaluate(() => document.querySelector('.details-close').click());
      // The compact marker is a separate operation from selecting or dragging a person.
      await page.evaluate(() => document.getElementById('tree-zoom-value').click());
      const marker = page.locator('.canvas-evidence').first();
      await marker.scrollIntoViewIfNeeded(); await activate(marker);
      assert.match(await page.locator('#relationship-proof-dialog').textContent(),/來源：訪談來源/); await proofClose();
      await page.click('#mobile-search-open');
      await page.locator('#relationship-a').selectOption('C',{force:true}); await page.locator('#relationship-b').selectOption('G',{force:true});
      await page.locator('#relationship-search [type=submit]').click();
      assert.equal(await page.locator('#relationship-summary .relationship-origin').textContent(),'推導');
      await page.getByRole('button',{name:'查看完整關係路徑',exact:true}).click();
      assert.equal(await page.locator('.relationship-path-evidence .evidence-record').count(),2);
      assert.match(await page.locator('#relationship-result-sheet').textContent(),/訪談來源 G/);
      await page.click('#relationship-result-sheet-close');
      await page.evaluate(() => document.getElementById('relationship-reset').click());
      await select('C');
      const siblings = page.locator('[data-group=siblings]'); await siblings.evaluate(el => el.open = true);
      const inferredBadge = siblings.locator('.relationship-entry').filter({has:page.locator('[data-person-id=S]')}).locator('.relationship-entry__badge--inferred');
      assert.equal(await inferredBadge.count(),1,'two shared parents produce one inferred badge');
      assert.equal(await inferredBadge.textContent(),'推導・查看依據'); await activate(inferredBadge);
      const siblingProof = page.locator('#relationship-proof-dialog');
      assert.doesNotMatch(await siblingProof.textContent(),/確認狀態|已確認|待確認|未標記/);
      assert.equal(await siblingProof.locator('.evidence-record').count(),2,'both parent paths remain available');
      assert.equal(await siblingProof.locator('.evidence-source').count(),4,'all four original parent records remain available');
      assert.match(await siblingProof.textContent(),/訪談來源 P/); assert.match(await siblingProof.textContent(),/訪談來源 Q/);
      if (mode === 'static' && width === 390) await page.screenshot({path:path.join(dir,'shared-parent-evidence-mobile.png')});
      await proofClose();
      assert(await inferredBadge.evaluate(node => node === document.activeElement));
      await inferredBadge.focus(); await page.keyboard.press('Enter');
      // Live evidence changes refresh an open proof dialog and all reading surfaces.
      await page.evaluate(async () => {const member = structuredClone(FamilyApp.snapshot().data.people.find(p => p.id === 'S')); member.relationships[0].source = '更新訪談來源'; await FamilyApp.updateMember('S',{version:FamilyApp.snapshot().version,member}); await FamilyEditor.reload();});
      assert.match(await page.locator('#relationship-proof-dialog').textContent(),/更新訪談來源/);
      assert.equal(await siblingProof.locator('.evidence-record').count(),2,'live refresh retains both paths without duplicates');
      assert.equal(await siblingProof.locator('.evidence-source').count(),4);
      assert.match(await siblingProof.textContent(),/訪談來源 Q/);
      await proofClose();
      assert.equal(await inferredBadge.count(),1); assert.equal(await inferredBadge.textContent(),'推導・查看依據');
      await page.waitForFunction(() => document.activeElement?.classList.contains('relationship-entry__badge--inferred'));
      assert(await inferredBadge.evaluate(node => node === document.activeElement),'refresh returns focus to the new badge');
      if (mode === 'static' && width === 390) {await inferredBadge.scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(dir,'inferred-badge-mobile.png')});}
      if (mode === 'static' && width === 1440) {
        await page.waitForFunction(() => getComputedStyle(document.getElementById('relationship-details')).opacity === '1');
        await page.screenshot({path:path.join(dir,'static-detail-desktop.png')});
      }
      // A direct record removes the inferred entry point; an open dialog must not switch to direct evidence.
      await activate(inferredBadge);
      await page.evaluate(async () => {const member = structuredClone(FamilyApp.snapshot().data.people.find(p => p.id === 'S')); member.relationships.push({type:'sibling',personId:'C',source:'直接記錄'}); await FamilyApp.updateMember('S',{version:FamilyApp.snapshot().version,member}); await FamilyEditor.reload();});
      assert.equal(await inferredBadge.count(),0); assert.equal(await siblingProof.locator('.evidence-record').count(),0);
      assert.match(await siblingProof.textContent(),/目前已無可顯示的關係依據/);
      await proofClose();
      if (touch) {
        await select('L');
        const geometry = await page.evaluate(() => {
          const panel = document.getElementById('relationship-details'),body = panel.querySelector('.relationship-details__body');
          const rect = n => n.getBoundingClientRect(); const group = body.querySelector('.relationship-group');
          return {titles:panel.querySelectorAll('h2').length,groupTop:rect(group).top,bodyBottom:rect(body).bottom,
            actions:[...panel.querySelectorAll('.relationship-details__actions > .details-action,.relationship-details__more-summary')].map(n => ({width:rect(n).width,height:rect(n).height})),
            titleHeight:rect(panel.querySelector('h2')).height,overflow:body.scrollWidth > body.clientWidth + 1,infoOpen:panel.querySelector('.member-information').open};
        });
        assert.equal(geometry.titles,1); assert(geometry.groupTop + 60 < geometry.bodyBottom,JSON.stringify(geometry));
        assert(geometry.titleHeight < 50,JSON.stringify(geometry));
        assert(geometry.actions.every(a => a.width >= 43 && a.height >= 43)); assert(!geometry.overflow); assert(!geometry.infoOpen);
        await page.locator('.detail-expand').click(); assert.equal(await page.locator('#relationship-details').getAttribute('data-reading'),'true');
        await page.locator('.member-information').evaluate(node => node.open = true);
        await page.locator('.relationship-details__body').evaluate(node => node.scrollTop = 200);
        const scroll = await page.locator('.relationship-details__body').evaluate(n => n.scrollTop);
        await page.evaluate(() => document.querySelector('[data-group=parents] .relationship-entry__person').click());
        await page.locator('.details-back').click();
        assert.equal(await page.locator('.relationship-details__body').evaluate(n => n.scrollTop),scroll,JSON.stringify(await page.evaluate(() => ({id:document.getElementById('relationship-details').dataset.memberId,reading:document.getElementById('relationship-details').dataset.reading,back:document.querySelector('.details-back').getAttribute('aria-label'),info:document.querySelector('.member-information')?.open,scrollHeight:document.querySelector('.relationship-details__body').scrollHeight,clientHeight:document.querySelector('.relationship-details__body').clientHeight}))));
        assert(await page.locator('.member-information').evaluate(n => n.open));
        await page.locator('.relationship-details__more-summary').click();
        await page.locator('.details-collapse').click(); assert.equal(await page.locator('#relationship-details').getAttribute('data-collapsed'),'true');
        await page.locator('.relationship-details__tab').click();
        await select('U'); assert(await page.locator('.relationship-details__empty').isVisible());
        await select('Z'); assert.equal(await page.locator('.relationship-details__identity .member-archive-badge').textContent(),'已封存');
        await select('L');
        await page.waitForFunction(() => getComputedStyle(document.getElementById('relationship-details')).opacity === '1');
        await page.locator('.relationship-details__body').evaluate(n => n.scrollTop = 0);
        await page.screenshot({path:path.join(dir,`${mode}-${width}x${height}.png`)});
        if (height > width) {
          const grabber = page.locator('.detail-grabber'),box = await grabber.boundingBox();
          await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2); await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2,Math.max(25,box.y - 160),{steps:12}); await page.mouse.up();
          await page.waitForFunction(() => document.getElementById('relationship-details').dataset.reading === 'true');
          await page.locator('.detail-expand').click();
          const next = await grabber.boundingBox();
          await page.mouse.move(next.x + next.width / 2,next.y + next.height / 2); await page.mouse.down();
          await page.mouse.move(next.x + next.width / 2,next.y + 180,{steps:12}); await page.mouse.up();
          await page.waitForFunction(() => document.getElementById('relationship-details').dataset.collapsed === 'true');
          await page.locator('.relationship-details__tab').click();
        }
      }
      await page.evaluate(() => document.querySelector('.details-close').click());
      // Full form flows are covered in both persistence adapters on desktop and a small phone.
      if (width === 1440 || width === 360) {
        for (const type of ['parent','child','grandparent','grandchild','teacher','student','spouse','sibling']) {
          await page.click('#add-member'); await page.click('#add-relation');
          assert.equal(await page.locator('.relation-direction').textContent(),'現有成員是新成員的');
          await page.locator('.relation-target').selectOption('U');
          await page.fill('#member-name','方向 ' + type);
          if (['parent','child','spouse'].includes(type)) await page.locator(`.relation-quick-options [data-type=${type}]`).click();
          else await page.locator('.relation-type').selectOption(type);
          assert.equal(await page.locator('.relation-type').inputValue(),type);
          assert.equal(await page.locator('.relation-direction').textContent(),'未連結是方向 ' + type + '的');
          await page.locator('.relation-advanced').evaluate(n => n.open = true);
          assert.equal(await page.locator('.relation-status,.relation-form-confidence').count(),0);
          assert.equal(await page.locator('.relation-advanced .relation-metadata').count(),2);
          await page.locator('.relation-source').fill('新增來源'); await page.locator('.relation-note').fill('新增說明');
          if (type === 'sibling') await page.locator('.relation-cousin-seniority').selectOption('older');
          if (mode === 'static' && width === 1440 && type === 'parent') {
            await page.waitForFunction(() => getComputedStyle(document.getElementById('member-dialog')).opacity === '1');
            await page.screenshot({path:path.join(dir,'static-direction-desktop.png')});
          }
          await page.click('#save-member'); await page.waitForFunction(() => !document.getElementById('member-dialog').open);
          const saved = await page.evaluate(name => FamilyApp.snapshot().data.people.find(p => p.name === name),'方向 ' + type);
          assert.equal(saved.relationships[0].type,type); assert.equal(saved.relationships[0].personId,'U'); assert.equal(saved.relationships[0].status,undefined);
          assert.equal(saved.relationships[0].source,'新增來源'); assert.equal(saved.relationships[0].note,'新增說明');
        }
        await page.evaluate(() => editFamilyMember('U'));
        const reverse = page.locator('.relation-row').filter({has:page.locator('.relation-type option[value=child]:checked')});
        assert.equal(await reverse.count(),1); assert.match(await reverse.locator('.relation-row__summary-title').textContent(),/方向 parent是未連結的子女/);
        assert.equal(await reverse.locator('.relation-status').count(),0); assert.equal(await reverse.locator('.relation-source').inputValue(),'新增來源'); await page.click('#cancel-member');
        await page.evaluate(() => editFamilyMember('T')); await page.locator('.relation-row').evaluate(row => row.expandEditor());
        await page.locator('.relation-advanced').evaluate(node => node.open = true); await page.locator('.relation-note').fill('舊關係的新說明'); await page.click('#save-member');
        await page.waitForFunction(() => !document.getElementById('member-dialog').open);
        const legacy = await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'T').relationships[0]);
        assert.equal(legacy.status,'pending'); assert.equal(legacy.note,'舊關係的新說明');
        await page.click('#add-member'); await page.fill('#member-name','未標記草稿'); await page.click('#add-relation');
        await page.locator('.relation-target').selectOption('U'); await page.locator('.relation-quick-options [data-type=child]').click();
        await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('family-tree:member-form-draft:v1') || '{}').state?.relationships?.[0]?.type === 'child');
        await page.reload(); await page.waitForFunction(() => FamilyEditor?.snapshot?.()); await page.click('#add-member'); await page.click('#resume-member-draft');
        assert.equal(await page.locator('.relation-status').count(),0); assert.equal(await page.locator('.relation-direction').textContent(),'未連結是未標記草稿的');
        await page.click('#save-member'); await page.waitForFunction(() => !document.getElementById('member-dialog').open);
        assert(!await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.name === '未標記草稿').relationships[0].status));
        await page.evaluate(() => FamilyEditor.addRelative('U','parent')); await page.fill('#member-name','預帶親屬');
        assert.equal(await page.locator('.relation-type').inputValue(),'parent'); assert.equal(await page.locator('.relation-direction').textContent(),'未連結是預帶親屬的');
        await page.click('#save-member'); await page.waitForFunction(() => !document.getElementById('member-dialog').open);
        await page.evaluate(() => { const plan = FamilyModel.intermediatePlans(FamilyApp.snapshot().data).find(p => p.near === 'I'); addIntermediateMember(plan.id); });
        assert(await page.locator('.relation-direction').count() >= 2); assert((await page.locator('.relation-type').evaluateAll(nodes => nodes.map(n => n.value))).every(t => t === 'child' || t === 'parent'));
        await page.click('#cancel-member');
      }
      assert.deepEqual(errors,[],`${mode} ${width} browser errors`); console.log(`${mode} ${width}x${height}: passed`); await context.close();
    }
    console.log('Phase 3 browser verification passed. Screenshots: ' + dir);
  } finally {
    await browser?.close(); if (staticServer) await new Promise(r => staticServer.close(r)); if (apiServer) await new Promise(r => apiServer.close(r));
  }
})().catch(e => {console.error(e);process.exitCode = 1;});
