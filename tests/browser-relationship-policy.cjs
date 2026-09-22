const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../server.cjs');
const { build } = require('../build.cjs');
const person = (id, gender='M', siblingOrder=null, relationships=[]) => ({id,name:id,gender,siblingOrder,relationships,location:'',position:''});
const fixture = () => ({schemaVersion:2,familyName:'驗證家族',people:[person('A'),person('B','F'),person('D'),person('T')].map((p,i)=>({...p,name:['阿明','阿華','重複資料','師父'][i]}))});
(async()=>{
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'family-policy-'));
  const output = path.join(temp,'site'); await build(output);
  const dataFile = path.join(temp,'family.json'); await fs.writeFile(dataFile,JSON.stringify(fixture()));
  const api = createFamilyServer({dataFile}); await new Promise(r=>api.listen(0,'127.0.0.1',r));
  const staticServer = http.createServer(async(req,res)=>{
    try {const file=path.join(output,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');
      res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html');res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  }); await new Promise(r=>staticServer.listen(0,'127.0.0.1',r));
  const browser = process.env.POLICY_WEBKIT ? await webkit.launch({headless:true}) : await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  try {
    for (const [mode,server] of [['api',api],['static',staticServer]]) {
      const page = await browser.newPage({viewport:{width:1280,height:900}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(()=>window.FamilyEditor?.snapshot());
      if(mode==='static') {
        const seed=fixture();
        // Fixture IDs match the application identifier format.
        seed.people.forEach((p,i)=>p.id=['A','B','D','T'][i]);
        await page.evaluate(async data=>{const current=await FamilyRepository.read();await FamilyRepository.request('/api/family/import',{method:'POST',body:JSON.stringify({data,version:current.version})});},seed);
        await page.reload(); await page.waitForFunction(()=>FAMILY.people.length===4);
      }
      async function choose(selector,value) {
        await page.locator(selector).selectOption(value,{force:true});
      }
      const ids = await page.evaluate(()=>Object.fromEntries(FAMILY.people.map(p=>[p.name,p.id])));
      const a=ids['阿明'],b=ids['阿華'],duplicate=ids['重複資料'];
      await page.evaluate(id=>editFamilyMember(id),b);
      await page.click('#add-relation'); await choose('.relation-target',a); await choose('.relation-type','sibling'); await choose('.relation-cousin-seniority','older');
      await page.fill('.relation-source','口述訪談'); await page.fill('.relation-note','排行尚待確認'); await choose('.relation-status','pending');
      assert.match(await page.locator('.relation-preview').textContent(),/阿明是阿華的兄；阿華是阿明的妹/);
      await page.click('#save-member'); await page.waitForFunction(()=>!document.getElementById('member-dialog').open);
      assert.match(await page.locator('[data-group=siblings]').textContent(),/直接設定/);
      assert.match(await page.locator('[data-group=siblings]').textContent(),/口述訪談/);
      await page.evaluate(id=>editFamilyMember(id),a); await page.fill('#member-order','2'); await page.click('#save-member'); await page.waitForFunction(()=>!document.getElementById('member-dialog').open);
      await page.evaluate(id=>editFamilyMember(id),b); await page.fill('#member-order','3'); await page.click('#save-member'); await page.waitForFunction(()=>!document.getElementById('member-dialog').open);
      assert.match(await page.locator('[data-group=siblings]').textContent(),/二兄/);
      await page.evaluate(id=>editFamilyMember(id),b); await page.fill('#member-order','1'); await page.click('#save-member');
      assert.match(await page.locator('#member-error').textContent(),/矛盾/);
      assert.equal(await page.locator('.relation-row').getAttribute('data-expanded'),'true');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('.relation-row')!==null),true);
      assert.equal(await page.evaluate(id=>FAMILY.people.find(p=>p.id===id).siblingOrder,b),3);
      // Server/storage validation must also reject a caller bypassing the form.
      const rejected = await page.evaluate(async id=>{const snapshot=FamilyEditor.snapshot();const p=snapshot.data.people.find(p=>p.id===id);const response=await FamilyRepository.request('/api/members/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:snapshot.version,member:{...p,siblingOrder:1,relationships:FamilyModel.relationshipsFor(snapshot.data,id)}})});return response.status;},b);
      assert.equal(rejected,400);
      await page.fill('#member-order','3'); await page.click('#save-member'); await page.waitForFunction(()=>!document.getElementById('member-dialog').open);
      // Contextual relative creation supplies the correct inverse direction.
      await page.evaluate(id=>openRelativePicker(id),a); await page.getByRole('button',{name:'新增子女',exact:true}).click();
      assert.equal(await page.locator('.relation-target').inputValue(),a); assert.equal(await page.locator('.relation-type').inputValue(),'parent');
      await page.fill('#member-name','孩子'); await choose('#member-gender','F');
      await page.click('#save-member'); await page.waitForFunction(()=>!document.getElementById('member-dialog').open);
      // Group editor, including independent ranks and a known relative-order conflict.
      await page.evaluate(()=>document.getElementById('member-list-dialog').showModal());
      await page.getByRole('button',{name:'排行群組',exact:true}).click();
      const groupDialog=page.locator('.family-management-dialog');
      await groupDialog.getByLabel('群組名稱',{exact:true}).fill('家庭排行');
      for(const name of ['阿明','阿華']) await groupDialog.getByRole('checkbox',{name,exact:true}).check();
      await groupDialog.getByLabel('阿明的群組排行').fill('4'); await groupDialog.getByLabel('阿華的群組排行').fill('3');
      await groupDialog.getByRole('button',{name:'儲存群組'}).click(); assert.match(await groupDialog.locator('.form-error').textContent(),/矛盾/);
      await groupDialog.getByLabel('阿明的群組排行').fill('2'); await groupDialog.getByRole('button',{name:'儲存群組'}).click(); await page.waitForFunction(()=>!document.querySelector('.family-management-dialog'));
      // Persistent undo also restores groups after a reload.
      await page.reload(); await page.waitForFunction(()=>FamilyEditor.snapshot()); await page.evaluate(()=>document.getElementById('member-list-dialog').showModal());
      await page.getByRole('button',{name:'復原：修改排行群組',exact:true}).click(); await page.waitForFunction(()=>!FamilyEditor.snapshot().data.rankGroups?.length);
      // Merge must be previewed and can be undone without losing source members.
      await page.getByRole('button',{name:'合併重複成員',exact:true}).click();
      const merge=page.locator('.family-management-dialog'); await merge.getByLabel('保留的成員',{exact:true}).selectOption(a); await merge.getByLabel('併入後移除的成員',{exact:true}).selectOption(duplicate);
      assert.equal(await merge.getByRole('button',{name:'確認合併'}).isDisabled(),true);
      await merge.getByRole('button',{name:'預覽合併'}).click(); assert.match(await merge.locator('.family-differences').textContent(),/移除成員：重複資料/);
      await merge.getByRole('button',{name:'確認合併'}).click(); await page.waitForFunction(()=>!document.querySelector('.family-management-dialog'));
      assert.equal(await page.evaluate(id=>FAMILY.people.some(p=>p.id===id),duplicate),false);
      await page.getByRole('button',{name:'復原：合併成員',exact:true}).click(); await page.waitForFunction(id=>FAMILY.people.some(p=>p.id===id),duplicate);
      await page.evaluate(()=>document.getElementById('member-list-dialog').close());
      // Import diff gives names and changed fields, without writing on preview.
      const imported=await page.evaluate(()=>structuredClone(FamilyEditor.snapshot().data)); imported.people[0].location='臺北';
      await page.locator('#import-file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
      await page.waitForFunction(()=>document.getElementById('import-dialog').open);
      assert.match(await page.locator('#import-dialog .family-differences').textContent(),/所在地.*臺北/);
      await page.click('#cancel-import');
      // Exercise the actual searchable popover across rotation and keyboard-like viewport changes.
      await page.evaluate(id=>editFamilyMember(id),b); await page.locator('.relation-row__toggle').click();
      for(const [width,height] of [[390,844],[844,390],[1024,1366]]) {
        await page.setViewportSize({width,height});
        await page.locator('.relation-target').locator('..').locator('.select-trigger').click();
        const input=page.locator('.select-dropdown:popover-open .select-search');
        assert.ok(await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=16);
        await input.fill('不存在的成員'); assert.match(await page.locator('.select-dropdown:popover-open').textContent(),/找不到符合/);
        await input.fill('阿'); await page.keyboard.press('ArrowDown');
        await page.evaluate(()=>{
          window.__vv={width:390,height:250,offsetLeft:0,offsetTop:200,addEventListener(){}};
          Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__vv}); dispatchEvent(new Event('resize'));
        });
        const box=await page.locator('.select-dropdown:popover-open').boundingBox(); assert(box.x>=7&&box.y>=207&&box.x+box.width<=383&&box.y+box.height<=443,JSON.stringify(box));
        await page.keyboard.press('Escape'); assert.equal(await page.locator('.select-dropdown:popover-open').count(),0);
        await page.evaluate(()=>{delete window.visualViewport;dispatchEvent(new Event('resize'));});
        await page.locator('.relation-target').locator('..').locator('.select-trigger').click();
        await page.locator('.select-dropdown:popover-open .select-search').fill('阿明'); await page.keyboard.press('Enter');
        assert.equal(await page.locator('.relation-target').inputValue(),a);
        await page.screenshot({path:path.join(temp,mode+'-'+width+'.png'),fullPage:true});
      }
      await page.screenshot({path:path.join(temp,mode+'-form.png'),fullPage:true});
      if (mode === 'static') {
        const remoteData = await page.evaluate(()=>structuredClone(FamilyEditor.snapshot().data)); remoteData.people[0].location='雲端新地址';
        let remoteVersion='2', writes=0;
        await page.route('https://www.googleapis.com/**', async route=>{
          const req=route.request();
          if (req.method()!=='GET') { writes++; await route.fulfill({json:{id:'mock-file',version:'3'}}); return; }
          await route.fulfill({json:req.url().includes('alt=media') ? remoteData : {files:[{id:'mock-file',version:remoteVersion,modifiedTime:'2026-09-22T00:00:00Z'}]}});
        });
        await page.evaluate(async()=>{await FamilyRepository.setSyncState({connected:true,dirty:true,fileId:'mock-file',remoteVersion:'1'});});
        await page.addInitScript(()=>{
          window.FAMILY_GOOGLE_CLIENT_ID='123-test.apps.googleusercontent.com';
          sessionStorage.setItem('family-tree-google-drive-token-v1',JSON.stringify({accessToken:'mock-test-token',tokenExpiresAt:Date.now()+3600000,scope:'https://www.googleapis.com/auth/drive.appdata',clientId:window.FAMILY_GOOGLE_CLIENT_ID}));
          window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};
        });
        await page.reload(); await page.waitForFunction(()=>FamilyEditor.snapshot()&&FamilyGoogleDriveSync);
        await page.waitForFunction(()=>document.getElementById('cloud-sync').dataset.syncState==='conflict');
        await page.evaluate(()=>{window.__syncResult=FamilyGoogleDriveSync.syncNow({interactive:true});});
        await page.waitForFunction(()=>document.getElementById('cloud-conflict-dialog').open);
        assert.match(await page.locator('#cloud-conflict-dialog .family-differences').textContent(),/雲端新地址/);
        remoteVersion='9'; await page.click('#cloud-conflict-use-local');
        await page.evaluate(()=>window.__syncResult);
        assert.equal(writes,0,'remote changes during review must prevent stale overwrite');
        assert.match(await page.locator('#cloud-sync-message').textContent(),/預覽期間資料已更新/);
        await page.evaluate(()=>{window.__syncResult=FamilyGoogleDriveSync.syncNow({interactive:true});});
        await page.waitForFunction(()=>document.getElementById('cloud-conflict-dialog').open);
        await page.click('#cloud-conflict-use-remote'); await page.evaluate(()=>window.__syncResult);
        await page.waitForFunction(()=>FAMILY.people[0].location==='雲端新地址');
        assert.equal(writes,0); console.log('PASS mock cloud: diff preview, stale remote guard, confirmed download');
      }
      assert.deepEqual(errors,[]); console.log('PASS '+mode+': relative ranks, validation, provenance, add relative, groups, merge, undo, import diff, popovers');
      await page.close();
    }
    console.log('Screenshots: '+temp);
  } finally {await browser.close();await Promise.all([new Promise(r=>api.close(r)),new Promise(r=>staticServer.close(r))]);}
})().catch(e=>{console.error(e);process.exitCode=1;});
