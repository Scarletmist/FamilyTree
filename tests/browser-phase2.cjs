const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { build } = require('../dev/build.cjs');
const { mimeTypeFor } = require('../dev/site-source.cjs');
const { createFamilyServer } = require('../dev/server.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const Location = require('../src/assets/family-location.js');
const p = (id,name,relationships = [],extra = {}) => ({ id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra });
const parent = personId => ({ type:'parent',personId,kind:'親生',status:'confirmed' });
const fixture = () => ({ schemaVersion:3,familyName:'第二階段驗證',people:[p('G','祖母'),p('P','母親',[parent('G')]),p('C','子女',[parent('P')]),p('S','手足',[parent('P')]),
  p('A','阿明',[{ type:'sibling',personId:'B',status:'pending',source:'訪談待查' }]),p('B','阿華',[{ type:'sibling',personId:'A',status:'pending' }]),
  p('U','未連結'),p('D1','同名'),p('D2','同名'),p('L','待定位',[],{ location:'未查到廟',geocode:Location.resolve('未查到廟',[],1) }),
  p('H','隱私',[],{ location:'住宅' }),p('Z','原封存',[],{ archive:{ archivedAt:'2026-10-11T00:00:00Z' },location:'臺北市' })],
  rankGroups:[{ id:'rank',name:'子女排行',type:'sibling',anchorId:'P',members:[{ personId:'C',order:1 },{ personId:'S',order:2 }] }] });
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-phase2-')); let server,apiServer,browser;
  try {
    await build(dir);
    server = http.createServer(async (req,res) => {
      try { const url = new URL(req.url,'http://localhost'); if (!url.pathname.startsWith('/repo/')) throw new Error('Outside test');
        const file = path.join(dir,url.pathname.slice(6) || 'index.html'); res.setHeader('Content-Type',mimeTypeFor(file)); res.end(await fs.readFile(file));
      } catch { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise(r => server.listen(0,'127.0.0.1',r));
    const dataFile = path.join(dir,'api-family.json'); await fs.writeFile(dataFile,JSON.stringify(fixture()));
    apiServer = createFamilyServer({ dataFile }); await new Promise(r => apiServer.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({ headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE } : { channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' }) });
    for (const mode of ['static','api']) for (const width of [1440,390]) {
      const url = mode === 'static' ? `http://127.0.0.1:${server.address().port}/repo/` : `http://127.0.0.1:${apiServer.address().port}/`;
      const context = await browser.newContext({ viewport:{ width,height:900 },reducedMotion:'reduce' }); context.setDefaultTimeout(10000);
      await context.route(/https:\/\/(.*\.google\.com|tile\.openstreetmap\.org)\//,route => route.abort());
      await context.route('https://nominatim.openstreetmap.org/**',route => route.fulfill({ json:[] }));
      const page = await context.newPage(),errors = []; page.on('pageerror',e => errors.push(e.message));
      await page.goto(url); await page.waitForFunction(() => FamilyApp?.snapshot?.() && window.FamilyMemberMap && window.FamilyLocationCorrection);
      await page.evaluate(async data => { await FamilyApp.importFamily({ data,version:FamilyApp.snapshot().version }); await FamilyEditor.reload(); },fixture());
      async function more(name) { await page.locator('[aria-label="更多功能"]:visible').first().click(); await page.click(`[data-action="${name}"]`); }
      async function select(id) { await page.evaluate(id => dispatchEvent(new CustomEvent('familytreeselect',{ detail:{ id,options:{ expandDetails:true } } })),id); }
      async function waitPreview() { await page.waitForFunction(() => { const dialog = document.getElementById('member-lifecycle-dialog'); return dialog && !dialog.dataset.busy; }); }
      async function confirm(label) { await waitPreview(); await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:label,exact:true }).click(); await page.waitForFunction(() => !document.getElementById('member-lifecycle-dialog')); }
      await select('U'); await page.locator('#relationship-details .relationship-details__more-summary').click();
      await page.locator('#relationship-details').getByRole('button',{ name:'封存成員',exact:true }).click(); await waitPreview();
      const beforeArchive = await page.evaluate(() => FamilyRepository.read());
      await page.getByLabel('封存原因（選填）').fill('暫存，保留親屬資料');
      assert.equal(await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'確認封存成員',exact:true }).isDisabled(),true);
      await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'重新預覽',exact:true }).click(); await waitPreview();
      await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'取消',exact:true }).click();
      assert.deepEqual(await page.evaluate(() => FamilyRepository.read()),beforeArchive);
      await page.evaluate(() => FamilyMaintenanceUI.openLifecycle('archiveMember','U')); await confirm('確認封存成員');
      assert.equal(await page.locator('.person[data-person-id="Z"]').count(),0,'standalone archived members stay out of the overview');
      await page.click('#show-member-list');
      assert.equal(await page.locator('#member-list-body [data-person-id="U"]').count(),0);
      await page.locator('[data-member-filter="archived"]').click(); assert.equal(await page.locator('#member-list-body [data-person-id="U"]').count(),1);
      await page.click('#close-member-list');
      await page.evaluate(() => editFamilyMember('C'));
      assert.equal(await page.locator('.relation-target option[value="U"]').count(),0);
      assert.equal(await page.locator('.relation-target option[value="Z"]').count(),0); await page.click('#cancel-member');
      await more('archived');
      await page.locator('#archived-members-dialog [data-person-id="U"]').getByRole('button',{ name:'解除封存',exact:true }).click(); await confirm('確認解除封存');
      assert.equal(await page.locator('#archived-members-dialog [data-person-id="U"]').count(),0);
      await page.locator('#archived-members-dialog').getByRole('button',{ name:'關閉封存成員',exact:true }).click();
      // An archived intermediate person remains a real, marked query bridge.
      await page.evaluate(() => FamilyMaintenanceUI.openLifecycle('archiveMember','P')); await confirm('確認封存成員');
      await page.click('#mobile-search-open'); await page.locator('#relationship-a').selectOption('C',{ force:true }); await page.locator('#relationship-b').selectOption('G',{ force:true });
      assert.equal(await page.locator('#relationship-a option[value="P"]').count(),0);
      await page.locator('#relationship-search [type=submit]').click();
      assert.equal(await page.locator('.person[data-person-id="P"][data-archived=true]').count(),1);
      await page.evaluate(() => document.getElementById('relationship-reset').click());
      await page.evaluate(() => FamilyMaintenanceUI.openLifecycle('unarchiveMember','P')); await confirm('確認解除封存');
      // A cross-tab update cannot commit an old deletion preview.
      await select('P'); await page.evaluate(() => FamilyMaintenanceUI.openLifecycle('deleteMember','P')); await waitPreview();
      const other = await context.newPage(); await other.goto(url); await other.waitForFunction(() => FamilyApp?.snapshot?.());
      await other.evaluate(async () => { const saved = await FamilyRepository.read(); await FamilyRepository.updateFamilyName({ version:saved.version,familyName:'另一分頁更新' }); });
      await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'確認移至回收區',exact:true }).click(); await waitPreview();
      assert.match(await page.locator('#member-lifecycle-dialog .form-error').textContent(),/更新/);
      assert(await page.evaluate(async () => (await FamilyRepository.read()).data.people.some(p => p.id === 'P')));
      await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'重新預覽',exact:true }).click(); await confirm('確認移至回收區');
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.recycleBin.length),1);
      assert.equal(await page.locator('#relationship-details').getAttribute('hidden'), '');
      assert(!await page.evaluate(() => JSON.parse(localStorage.getItem('family-tree:recent-members:v1:' + location.pathname) || '[]').includes('P')));
      await other.evaluate(() => editFamilyMember('P')); await other.fill('#member-notes','尚未提交的內容');
      await other.evaluate(() => document.getElementById('refresh-family').click());
      await other.waitForFunction(() => document.getElementById('member-error').textContent.includes('已不在族譜'));
      assert.equal(await other.inputValue('#member-notes'),'尚未提交的內容'); assert.equal(await other.locator('#save-member').isDisabled(),true);
      assert.equal(await other.evaluate(() => FamilyEditor.snapshot().data.people.some(p => p.id === 'P')),false);
      const preserved = await other.evaluate(() => FamilyRepository.read());
      await other.evaluate(() => document.getElementById('member-form').requestSubmit());
      assert.deepEqual(await other.evaluate(() => FamilyRepository.read()),preserved);
      assert.equal(await other.locator('#save-member').isDisabled(),true);
      await other.close();
      // The changed anchor must be explicitly omitted, preserving the newer group.
      await page.evaluate(async () => { const current = FamilyApp.snapshot(); const groups = structuredClone(current.data.rankGroups); groups[0].anchorId = 'G'; await FamilyEditor.manage({ action:'rankGroups',rankGroups:groups,version:current.version }); });
      await more('recycle'); await page.locator('#recycle-bin-dialog').getByRole('button',{ name:'預覽還原',exact:true }).click(); await waitPreview();
      assert.match(await page.locator('#member-lifecycle-dialog .maintenance-conflicts').textContent(),/已改用其他/);
      assert.equal(await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'確認還原成員',exact:true }).isDisabled(),true);
      await page.getByLabel('還原排行群組：子女排行',{ exact:true }).uncheck();
      await page.locator('#member-lifecycle-dialog').getByRole('button',{ name:'重新預覽',exact:true }).click(); await confirm('確認還原成員');
      assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.rankGroups[0].anchorId),'G');
      await page.locator('#recycle-bin-dialog').getByRole('button',{ name:'關閉回收區',exact:true }).click();
      await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.());
      assert(await page.evaluate(() => FamilyApp.snapshot().data.people.some(p => p.id === 'P')));
      await more('workbench'); const workbench = page.locator('#family-workbench-dialog');
      assert.equal(await workbench.locator('[data-category=pending]').count(),0);
      assert.equal(await workbench.locator('.maintenance-item[data-category=duplicate]').count(),1);
      assert.equal(await workbench.locator('.maintenance-item[data-category=location]').count(),1);
      assert.equal(await workbench.evaluate(n => n.scrollWidth <= n.clientWidth),true);
      await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('family-workbench-dialog')).opacity) >= .999);
      await page.screenshot({ path:path.join(dir,`workbench-${mode}-${width}.png`) });
      await workbench.locator('button[data-category=unlinked]').click(); await workbench.getByLabel('搜尋待整理資料').fill('未連結');
      const top = await workbench.locator('.dialog-scroll').evaluate(n => n.scrollTop);
      await workbench.getByRole('button',{ name:'編輯成員',exact:true }).click();
      await page.locator('.member-optional-fields').evaluate(node => node.open = true);
      await page.locator('#member-notes').fill('工作台編輯說明'); await page.click('#save-member');
      await page.waitForFunction(() => !document.getElementById('member-dialog').open);
      assert.equal(await workbench.getByLabel('搜尋待整理資料').inputValue(),'未連結');
      assert.equal(await workbench.locator('button[data-category=unlinked]').getAttribute('aria-pressed'),'true');
      assert.equal(await workbench.locator('.maintenance-item').count(),1);
      assert.equal(await workbench.locator('.dialog-scroll').evaluate(n => n.scrollTop),top);
      await workbench.getByLabel('搜尋待整理資料').fill(''); await workbench.locator('button[data-category=intermediate]').click();
      await workbench.getByRole('button',{ name:'忽略此待補項目',exact:true }).click(); await page.waitForFunction(() => FamilyMaintenance.tasks(FamilyApp.snapshot().data).counts.intermediate === 0);
      await workbench.locator('button[data-category=duplicate]').click(); await workbench.getByRole('button',{ name:'比較並合併',exact:true }).click();
      const merge = page.locator('.family-management-dialog:not(.family-maintenance-dialog)');
      assert.equal(await merge.getByLabel('保留的成員',{ exact:true }).inputValue(),'D1');
      await merge.getByRole('button',{ name:'關閉合併重複成員',exact:true }).click();
      assert.equal(await workbench.locator('.maintenance-item').count(),1,'cancel never merges candidates');
      await workbench.getByRole('button',{ name:'比較並合併',exact:true }).click(); await merge.getByRole('button',{ name:'預覽合併',exact:true }).click(); await merge.getByRole('button',{ name:'確認合併',exact:true }).click();
      await page.waitForFunction(() => FamilyMaintenance.tasks(FamilyApp.snapshot().data).counts.duplicate === 0);
      await workbench.locator('button[data-category=location]').click(); await workbench.getByRole('button',{ name:'修正地點',exact:true }).click();
      await page.waitForFunction(() => document.getElementById('member-map-dialog').dataset.editing === 'true');
      await page.click('#location-mode-map'); await page.click('#save-location-correction');
      await page.waitForFunction(() => document.getElementById('member-map-dialog').dataset.editing !== 'true');
      await page.click('#close-member-map'); assert.equal(await workbench.locator('.maintenance-item').count(),0);
      await workbench.locator('button[data-category=unlinked]').click(); await workbench.getByLabel('搜尋待整理資料').fill('未連結');
      await workbench.getByRole('button',{ name:'編輯成員',exact:true }).click(); await page.click('#add-relation');
      await page.locator('.relation-target').selectOption('G',{ force:true }); await page.locator('.relation-type').selectOption('teacher',{ force:true }); await page.click('#save-member');
      await page.waitForFunction(() => !document.getElementById('member-dialog').open); assert.equal(await workbench.locator('.maintenance-item').count(),0);
      await workbench.getByRole('button',{ name:'關閉待整理資料',exact:true }).click();
      assert.deepEqual(errors,[]); console.log(`PASS phase 2 ${mode} ${width}: archive/visibility/query bridge, cancel/stale delete, deleted open form, restore conflict, workbench four categories, edit/ignore/merge/map return.`);
      await context.close();
    }
    console.log('Screenshots: ' + dir);
  } finally { await browser?.close(); if (server) await new Promise(r => server.close(r)); if (apiServer) await new Promise(r => apiServer.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
