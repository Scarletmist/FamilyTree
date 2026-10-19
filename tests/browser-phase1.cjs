// Phase 1 integration in the production IndexedDB path. All data is isolated in a test browser context.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../dev/build.cjs');
const { mimeTypeFor } = require('../dev/site-source.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const p = (id,name,relationships = []) => ({ id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships });
const old = { schemaVersion:2,familyName:'階段一驗證',extension:{ preserved:true },people:[p('G','祖母'),
  p('P','母親',[{ type:'parent',personId:'G',kind:'親生',source:'家族記錄',status:'confirmed' }]),
  p('C','子女',[{ type:'parent',personId:'P',kind:'親生',status:'confirmed' }])] };
const previous = { ...old,familyName:'先前的名稱' };
const history = [{ data:previous,version:'prior-v2',label:'修改家族名稱',savedAt:1 }];
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-phase1-'));
  let browser, server;
  try {
    await build(dir);
    server = http.createServer(async (req,res) => {
      try {
        const pathname = new URL(req.url,'http://localhost').pathname;
        if (!pathname.startsWith('/repo/')) throw new Error('Outside test project');
        const file = path.join(dir,pathname.slice(6) || 'index.html');
        res.setHeader('Content-Type',mimeTypeFor(file)); res.end(await fs.readFile(file));
      } catch { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise(r => server.listen(0,'127.0.0.1',r));
    browser = await chromium.launch({ headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath:process.env.PLAYWRIGHT_EXECUTABLE } : { channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' }) });
    const context = await browser.newContext({ viewport:{ width:1440,height:960 },reducedMotion:'reduce' });
    context.setDefaultTimeout(10000);
    await context.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value,...args) {
        if (location.search.includes('migration-fail') && value?.key === 'schema-v2-backup') throw new DOMException('Backup failed','QuotaExceededError');
        return put.call(this,value,...args);
      };
      window.__records = async (entries = null) => {
        const db = await new Promise((resolve,reject) => {
          const request = indexedDB.open('family-tree-v2:/repo/',1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise((resolve,reject) => {
            const tx = db.transaction('records',entries ? 'readwrite' : 'readonly'),store = tx.objectStore('records');
            let result;
            if (entries) entries.forEach(([key,value]) => store.put({ key,value }));
            else { const request = store.getAll(); request.onsuccess = () => { result = Object.fromEntries(request.result.map(r => [r.key,r.value])); }; }
            tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
          });
        } finally { db.close(); }
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror',e => errors.push(e.message));
    const url = `http://127.0.0.1:${server.address().port}/repo/`;
    await page.goto(url); await page.waitForFunction(() => FamilyApp?.snapshot?.());
    await page.evaluate(async ({ old,history }) => __records([
      ['current',{ data:old,version:'old-v2',savedAt:1 }],['history',history],['sync',{ dirty:false,connected:false }]
    ]),{ old,history });
    await page.goto(url + '?migration-fail'); await page.getByRole('button',{ name:'重試載入',exact:true }).waitFor();
    const failed = await page.evaluate(() => __records());
    assert.deepEqual(failed.current.data,old,'failed backup rolls back the upgraded current record');
    assert.deepEqual(failed.history,history); assert.equal(failed.sync.dirty,false); assert.equal(failed['schema-v2-backup'],undefined);
    assert.equal(await page.evaluate(() => FamilyApp.snapshot()),null);
    await page.goto(url); await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data.schemaVersion === 3);
    const loaded = await page.evaluate(() => FamilyApp.snapshot());
    assert.equal(loaded.undoLabel,'修改家族名稱');
    assert.deepEqual((await page.evaluate(() => FamilyApp.getSchemaBackup())).data,old);
    const source = value => ({ ...value,schemaVersion:2,people:value.people.map(({ inferredRelationships,...p }) => p) });
    assert.deepEqual(source(loaded.data),old);
    assert.deepEqual((await page.evaluate(() => __records())).history,history,'migration does not consume undo');
    await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.schemaVersion),3,'undo never downgrades runtime data');
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.familyName),'先前的名稱');
    await page.evaluate(old => FamilyApp.importFamily({ data:old,version:FamilyApp.snapshot().version }),old);
    assert.deepEqual((await page.evaluate(() => FamilyApp.getSchemaBackup('import'))).data,old);
    await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.());

    // A v2 cloud copy of the same data is backed up and migrated without invalidating an open edit form.
    await page.evaluate(() => editFamilyMember('P'));
    const noOp = await page.evaluate(async old => {
      const before = await FamilyRepository.read();
      await FamilyRepository.replaceFromCloud(old,{ fileId:'test-copy',remoteVersion:'2' },before.version);
      return { before:before.version,after:(await FamilyRepository.read()).version,backup:await FamilyApp.getSchemaBackup('cloud') };
    },old);
    assert.equal(noOp.before,noOp.after); assert.deepEqual(noOp.backup.data,old);
    assert.equal(await page.locator('.relation-status').count(),0);
    await page.fill('#member-notes','來源與說明仍會保存'); await page.click('#save-member');
    await page.waitForFunction(() => !document.getElementById('member-dialog').open).catch(async error => {
      throw new Error('Save failed: ' + await page.evaluate(() => ({
        error:document.getElementById('member-error').textContent,
        invalid:[...document.querySelectorAll('#member-form :invalid')].map(n => ({ cls:n.className,value:n.value,message:n.validationMessage })),
        status:document.getElementById('save-status').textContent
      })).then(JSON.stringify),{ cause:error });
    });
    await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.());
    await page.evaluate(() => editFamilyMember('P'));
    assert.equal(await page.locator('.relation-status').count(),0); assert.equal(await page.evaluate(() => FamilyModel.relationshipsFor(FamilyApp.snapshot().data,'P')[0].status),'confirmed'); await page.click('#cancel-member');

    const unchanged = await page.evaluate(() => FamilyRepository.read());
    const preview = await page.evaluate(() => FamilyApp.previewLifecycle({ type:'archiveMember',id:'P',reason:'暫存' }));
    assert.equal(preview.canApply,true); assert(preview.differences.items.some(i => i.field === 'archive'));
    assert.deepEqual(await page.evaluate(() => FamilyRepository.read()),unchanged,'preview and cancel do not write');
    await page.evaluate(() => FamilyApp.updateFamilyName({ version:FamilyApp.snapshot().version,familyName:'預覽後更新' }));
    const stale = await page.evaluate(async version => {
      try { await FamilyApp.lifecycleCommand({ type:'archiveMember',id:'P',version }); return 200; } catch(e) { return e.status; }
    },preview.version); assert.equal(stale,409);
    await page.evaluate(() => FamilyApp.lifecycleCommand({ type:'archiveMember',id:'P',reason:'暫存' }));
    const archived = await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'P').archive);
    await page.evaluate(() => FamilyApp.lifecycleCommand({ type:'deleteMember',id:'P' }));
    assert.equal(await page.evaluate(() => FamilyApp.snapshot().data.recycleBin.length),1);
    await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
    assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'P').archive),archived);
    await page.evaluate(() => FamilyApp.lifecycleCommand({ type:'deleteMember',id:'P' }));
    const exported = await page.evaluate(() => FamilyApp.exportData());
    await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.());
    assert.deepEqual(await page.evaluate(() => FamilyApp.exportData()),exported);
    assert.equal(await page.evaluate(() => FamilyRepository.isPristine({ schemaVersion:3,familyName:'我的家族',people:[],recycleBin:FamilyApp.snapshot().data.recycleBin })),false);
    await page.evaluate(async exported => {
      const current = await FamilyRepository.read(); await FamilyRepository.replaceFromCloud(exported,{ fileId:'test-roundtrip',remoteVersion:'3' },current.version);
    },exported);
    assert.deepEqual(await page.evaluate(() => FamilyApp.exportData()),exported,'lifecycle survives cloud JSON roundtrip');
    await page.evaluate(() => FamilyApp.lifecycleCommand({ type:'restoreMember',id:'P' }));
    assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot().data.people.find(p => p.id === 'P').archive),archived);
    await page.evaluate(() => FamilyApp.lifecycleCommand({ type:'unarchiveMember',id:'P' }));
    await page.reload(); await page.waitForFunction(() => FamilyApp?.snapshot?.());

    // Render through the existing import preview: accessible filters, full long text, and narrow layout.
    const changed = await page.evaluate(() => structuredClone(FamilyApp.snapshot().data));
    changed.people.find(p => p.id === 'P').notes = '新的家族備註\n<script>僅為文字</script>\n' + '完整記錄。'.repeat(150);
    changed.people.find(p => p.id === 'P').relationships[0].source = '更新的家族來源';
    changed.people.find(p => p.id === 'C').position = '教師';
    changed.locationLookupDeviceId = 'test-device';
    await page.locator('#import-file').setInputFiles({ name:'phase1-preview.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed)) });
    await page.waitForFunction(() => document.getElementById('import-dialog').open);
    const diff = page.locator('#import-dialog .family-differences');
    assert.match(await diff.textContent(),/更新的家族來源/); assert.match(await diff.textContent(),/母親是祖母的子女/);
    assert.equal(await diff.locator('.family-diff-group').filter({ hasText:'定位裝置' }).count(),0);
    await diff.getByLabel('搜尋差異').fill('教師'); assert.equal(await diff.locator('.family-diff-row').count(),1);
    await diff.getByLabel('搜尋差異').fill('');
    await diff.getByLabel('差異類別').selectOption('relationship'); assert.equal(await diff.locator('.family-diff-row').count(),1);
    await diff.getByLabel('差異類別').selectOption('all');
    await diff.getByLabel('顯示系統資料').check(); assert.match(await diff.textContent(),/test-device/);
    await diff.getByLabel('顯示系統資料').uncheck();
    await diff.locator('.family-diff-long summary').first().click();
    assert.match(await diff.locator('pre').first().textContent(),/<script>僅為文字/);
    assert.equal(await diff.locator('script').count(),0);
    await page.screenshot({ path:path.join(dir,'comparison-desktop.png') });
    await page.setViewportSize({ width:390,height:844 });
    assert.equal(await page.locator('#import-dialog').evaluate(n => n.scrollWidth <= n.clientWidth),true);
    assert.equal(await diff.locator('.family-diff-row').first().evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length),1);
    await page.screenshot({ path:path.join(dir,'comparison-mobile.png') });
    const beforeCancel = await page.evaluate(() => FamilyApp.snapshot().version);
    await page.click('#cancel-import'); assert.equal(await page.evaluate(() => FamilyApp.snapshot().version),beforeCancel);
    assert.deepEqual(errors,[]);
    console.log('PASS: atomic v2 migration failure/recovery, backups, undo, optional sources and legacy metadata, lifecycle preview/stale/delete/restore, reload/cloud roundtrip, desktop/mobile structured differences.');
    console.log('Screenshots: ' + dir);
  } finally { await browser?.close(); if (server) await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
