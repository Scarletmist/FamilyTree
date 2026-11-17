// Regression tests for validation, select values and focus across canvas rebuilds.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const {launchBrowser} = require('./helpers/browser-runtime.cjs');
const {renderFamilyTreeHtml,resolvePublicFile,mimeTypeFor} = require('../dev/site-source.cjs');
const person = (id,name,relationships=[]) => ({id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships});
const fixture = {schemaVersion:3,familyName:'P1 accessibility regression',locationLookupDeviceId:'another-test-device',people:[person('A','長輩'),person('B','子女',[{type:'parent',personId:'A',kind:'親生'}]),person('U','獨立成員')]};
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function openMember(page) {
  await page.locator('#add-member').click();
  await page.locator('#member-dialog').evaluate(async dialog=>{
    await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
  });
  await frames(page);
}
async function refresh(page,removeId) {
  await page.evaluate(id => {
    const payload = FamilyApp.snapshot();
    FamilyApp.adopt(id ? {...payload,data:{...payload.data,people:payload.data.people.filter(p=>p.id!==id)}} : payload,'regression-background-refresh');
  },removeId);
  await frames(page);
}
const cases = {
  async validation(page) {
    await openMember(page);
    await page.evaluate(()=>document.querySelectorAll('#member-form details').forEach(d=>d.open=true));
    const rank=page.locator('#member-order');
    await rank.evaluate(el=>{
      const hint=document.createElement('small');hint.id='regression-rank-help';hint.textContent='原有欄位提示';el.after(hint);el.setAttribute('aria-describedby',hint.id);
    });
    await rank.fill('0');await rank.blur();
    assert.equal(await rank.getAttribute('aria-invalid'),'true');
    await rank.fill('-1');
    assert.equal(await rank.evaluate(el=>el.validity.valid),false);
    assert.equal(await rank.getAttribute('aria-invalid'),'true','Still-invalid input must retain the error state');
    const description = await rank.getAttribute('aria-describedby');
    assert(description.includes('regression-rank-help'));
    assert(await rank.evaluate(el=>(el.getAttribute('aria-describedby')||'').split(/\s+/).some(id=>document.getElementById(id)?.textContent.includes('1–999'))),'The field describes the current error');
    await rank.fill('1');
    assert.equal(await rank.getAttribute('aria-invalid'),'false');
    assert.equal(await rank.getAttribute('aria-describedby'),'regression-rank-help','Clearing errors preserves unrelated hints');
    const name=page.locator('#member-name');
    await name.fill(' ');await name.blur();await name.fill('  ');
    assert.equal(await name.getAttribute('aria-invalid'),'true','Whitespace is still an invalid name');
    await name.fill('測試成員');
    assert.equal(await name.getAttribute('aria-invalid'),'false');
    assert.equal(await name.getAttribute('aria-describedby'),null);
    await page.locator('#add-relation').click();
    const target=page.locator('.relation-target'),trigger=page.locator('.relation-target + .select-trigger');
    await target.evaluate(el=>el.reportValidity());
    assert.equal(await trigger.getAttribute('aria-invalid'),'true','Validation reaches the actual select trigger');
    assert(await trigger.getAttribute('aria-describedby'));
    await page.locator('.select-dropdown:popover-open [role=option]').filter({hasText:/^長輩（/}).click();
    assert.equal(await trigger.getAttribute('aria-invalid'),'false');
    assert.equal(await trigger.getAttribute('aria-describedby'),null);
    await page.locator('#member-form').evaluate(form=>form.reset());await frames(page);
    assert.equal(await rank.getAttribute('aria-invalid'),'false');
    assert.equal(await name.getAttribute('aria-invalid'),'false');
    assert.equal(await page.locator('#member-name-error').textContent(),'');
    assert.equal(await rank.getAttribute('aria-describedby'),'regression-rank-help');
    assert.equal(await page.locator('#member-form [aria-live=polite]').count(),1,'A single announcer stays inside the modal form');
  },
  async select(page) {
    await openMember(page);
    const trigger=page.locator('#member-gender + .select-trigger');
    assert(await page.getByRole('button',{name:'性別：未知／尚未確認',exact:true}).isVisible(),'Accessible name includes the current selection');
    await trigger.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await page.locator('#member-gender').inputValue(),'M');
    assert(await page.getByRole('button',{name:'性別：男',exact:true}).isVisible());
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
    await trigger.click();await page.locator('.select-dropdown:popover-open').getByRole('option',{name:'女',exact:true}).click();
    assert(await page.getByRole('button',{name:'性別：女',exact:true}).isVisible());
    await trigger.click();await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
    assert.equal(await page.locator('#member-dialog').evaluate(el=>el.open),true);
    await page.locator('#member-form').evaluate(form=>form.reset());await frames(page);
    assert(await page.getByRole('button',{name:'性別：未知／尚未確認',exact:true}).isVisible(),'Programmatic reset updates the spoken value');
  },
  async focus(page) {
    const card=page.locator('.person[data-person-id=A]');
    await card.focus();await refresh(page);
    assert.equal(await page.evaluate(()=>document.activeElement.dataset.personId),'A','Refresh preserves the same member focus');
    await page.locator('.person[data-person-id=U]').focus();await refresh(page,'U');
    assert.equal(await page.evaluate(()=>document.activeElement.matches('main.tree')),true,'A removed member falls back to the labeled canvas');
    await page.locator('#show-member-list').focus();await refresh(page);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'show-member-list','Refresh does not steal toolbar focus');
    await openMember(page);await page.locator('#member-name').fill('保留草稿');await refresh(page);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'member-name','Refresh does not steal form focus');
    assert.equal(await page.locator('#member-name').inputValue(),'保留草稿');
    await page.locator('#member-gender + .select-trigger').click();
    const activeBefore=await page.evaluate(()=>document.activeElement.id);await refresh(page);
    assert.equal(await page.evaluate(()=>document.activeElement.id),activeBefore,'An open picker retains its focus');
  }
};
(async()=>{
  const html=await renderFamilyTreeHtml({browserStorage:true});
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
      const file=resolvePublicFile(url.pathname);if(!file)throw Error('Not public');
      res.setHeader('Content-Type',mimeTypeFor(file));res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end('Not found');}
  });
  let browser,failures=0,checks=0;
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    browser=await launchBrowser();
    for(const [width,height] of [[1440,1000],[390,844],[360,640],[844,390],[320,568]].filter(([w,h])=>!process.env.P1_VIEWPORT||process.env.P1_VIEWPORT===`${w}x${h}`))for(const [name,check] of Object.entries(cases).filter(([name])=>!process.env.P1_CASE_FILTER||name===process.env.P1_CASE_FILTER)){
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<950,reducedMotion:'reduce'});
      let page;
      try {
        await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
        await context.addInitScript(data=>{
          localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'p1-regression'}));
          localStorage.setItem('family-tree:canvas-guide:v1','seen');
        },fixture);
        page=await context.newPage();const errors=[];page.setDefaultTimeout(12000);
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>globalThis.FamilyApp?.snapshot()&&document.querySelectorAll('.person').length===3);await frames(page);
        await check(page);assert.deepEqual(errors,[]);
        console.log(`PASS ${name} ${width}x${height}`);
      }catch(error){
        failures++;console.error(`FAIL ${name} ${width}x${height}: ${error.stack}`);
        if(page&&process.env.P1_OUTPUT_DIR)try{
          const path=require('node:path'),dir=process.env.P1_OUTPUT_DIR;await fs.mkdir(dir,{recursive:true});
          await page.screenshot({path:path.join(dir,`${name}-${width}x${height}.png`)});
          const state=await page.evaluate(()=>({active:document.activeElement.id,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),relations:document.getElementById('member-relations').innerHTML,errors:document.getElementById('member-error').textContent}));
          await fs.writeFile(path.join(dir,`${name}-${width}x${height}.json`),JSON.stringify(state,null,2));
        }catch(diagnosticError){console.error(diagnosticError.message);}
      }
      finally{checks++;await context.close();}
    }
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
  console.log(`${checks-failures}/${checks} scenarios passed`);if(failures||!checks)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
