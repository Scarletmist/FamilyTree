// Reproduce the narrow toolbar, import footer and member-action regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium,webkit} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');
const person = (id,name,relationships=[],extra={}) => ({id,name,gender:'M',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent = personId => ({type:'parent',personId,kind:'親生'});
const fixture = {schemaVersion:3,familyName:'長家族名稱與按鈕布局測試'.repeat(6),locationLookupDeviceId:'another-device',people:[
  person('g','祖父'),person('p','父親',[parent('g')]),person('m','母親',[],{gender:'F'}),
  person('a','陳氏家族名字很長的成員甲',[parent('p'),parent('m'),{type:'biaoCousin',personId:'c'}]),
  person('b','成員乙',[parent('p'),parent('m')],{gender:'F'}),person('c','表親'),
  person('u','待定位成員',[],{location:'城隍廟',geocode:{provider:'nominatim',query:'城隍廟',checkedAt:1,status:'ambiguous'}})
]};
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function targets(page, selector, container) {
  const errors = await page.evaluate(({selector,container}) => {
    const host = document.querySelector(container),bounds = host.getBoundingClientRect();
    const visible = node => {
      const r=node.getBoundingClientRect(),s=getComputedStyle(node);
      if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden'||node.closest('[hidden],[inert]')) return false;
      for(let a=node.parentElement;a&&a!==host;a=a.parentElement) if(a.tagName==='DETAILS'&&!a.open&&!a.querySelector(':scope>summary')?.contains(node))return false;
      return true;
    };
    const buttons=[...host.querySelectorAll(selector)].filter(visible),errors=[];
    for(let i=0;i<buttons.length;i++) {
      const node=buttons[i],r=node.getBoundingClientRect(),name=node.getAttribute('aria-label')||node.textContent;
      if(r.width<43.5||r.height<43.5||r.left<bounds.left-.5||r.right>bounds.right+.5)errors.push({name,reason:'target bounds',width:r.width,height:r.height,x:r.x,host:bounds.toJSON()});
      for(const label of node.querySelectorAll('.details-action__label,.detail-nav-label,.tree-control-short'))if(visible(label)) {
        const b=label.getBoundingClientRect();if(b.left<r.left-.5||b.right>r.right+.5||label.scrollWidth>label.clientWidth+1)errors.push({name,reason:'clipped label'});
      }
      for(const other of buttons.slice(i+1)) {
        const b=other.getBoundingClientRect();
        if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)errors.push({name,other:other.textContent,reason:'overlap'});
      }
    }
    return errors;
  },{selector,container});
  assert.deepEqual(errors,[],`${container}: ${JSON.stringify(errors)}`);
}
(async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'family-buttons-')),file=path.join(temp,'family.json');
  await fs.writeFile(file,JSON.stringify(fixture));
  const server=createFamilyServer({dataFile:file});let browser;
  const out=process.env.BUTTON_LAYOUT_OUTPUT || path.resolve('.codebase-memory/phase5-results/button-layout-'+(process.env.PLAYWRIGHT_ENGINE || 'chromium'));await fs.mkdir(out,{recursive:true});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`,html=await renderFamilyTreeHtml({browserStorage:true});
    const useWebKit=process.env.PLAYWRIGHT_ENGINE==='webkit';
    browser=await(useWebKit?webkit:chromium).launch({headless:true,...(useWebKit?{}:{channel:'msedge'})});
    for(const [width,height] of [[1440,1000],[1280,800],[768,1024],[1024,768],[390,844],[320,568],[844,390],[667,375]].filter(([w,h])=>!process.env.TEST_VIEWPORT||process.env.TEST_VIEWPORT===`${w}x${h}`)) {
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<1280,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
      context.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
      await context.route(base+'/',route=>route.fulfill({contentType:'text/html',body:html}));
      await context.route(/^https:\/\/(tile\.openstreetmap\.org|mt[0-3]\.google\.com)\//,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4ebdd"/></svg>'}));
      await context.route('https://nominatim.openstreetmap.org/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
      await context.route('https://accounts.google.com/**',route=>route.abort());
      await context.addInitScript(data=>{localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'buttons-test'}));localStorage.setItem('family-tree:canvas-guide:v1','seen');},fixture);
      await page.goto(base);await page.waitForFunction(()=>FamilyApp?.snapshot?.()&&!document.getElementById('add-member').disabled);await frames(page);
      const initial=await page.evaluate(()=>JSON.stringify(FamilyApp.snapshot().data));
      const compact=width<=700||(width<=950&&height<=520);
      await targets(page,'button','.page-header');
      assert(await page.locator('#show-member-list .tree-control-'+(compact?'short':'text')).isVisible());
      assert(await page.locator('#add-member .tree-control-'+(compact?'short':'text')).isVisible());
      assert.equal(await page.locator('.tree-controls [aria-label="更多功能"]:visible').evaluate(el=>el.getBoundingClientRect().width),44);
      if(compact) await page.waitForFunction(()=>document.getElementById('family-title').dataset.truncated==='true');
      await page.locator('#family-title').click();assert.equal(await page.locator('#family-title-full').innerText(),fixture.familyName);await page.locator('.family-title-dialog button').click();
      await page.locator('#family-filter').selectOption({index:1},{force:true});await frames(page);
      await targets(page,'button','.workspace-toolbar');
      await page.screenshot({path:path.join(out,`${width}x${height}-family.png`)});
      await page.locator('#family-scope-reset').click();

      await page.evaluate(()=>dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'a',options:{expandDetails:true}}})));await frames(page);
      await targets(page,'button','.relationship-details__navigation');
      await targets(page,':scope>button,:scope>details>summary','.relationship-details__actions');
      await targets(page,'button','.page-header');await targets(page,'button','.workspace-toolbar');
      assert(await page.locator('.add-relative .details-action__label').isVisible());
      if(compact) {
        await page.locator('.detail-expand').click();assert.equal(await page.locator('#relationship-details').getAttribute('data-reading'),'true');
        assert.equal(await page.locator('.detail-expand').innerText(),'返回圖譜');await page.locator('.detail-expand').click();
      }
      await page.locator('.relationship-details__more-summary').click();await targets(page,'button','.relationship-details__more-body');
      if(compact) {
        await page.locator('.details-collapse').click();await page.locator('.relationship-details__tab').click();
        assert.equal(await page.locator('.detail-expand').evaluate(el=>el===document.activeElement),true,'Reopening focuses a visible control');
      } else await page.locator('.relationship-details__more-summary').click();
      await page.screenshot({path:path.join(out,`${width}x${height}-details.png`)});
      await page.locator('.details-close').click();

      const imported=structuredClone(fixture);imported.people[3].position='供比對使用';
      await page.locator('#import-file').setInputFiles({name:'buttons.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
      await page.locator('#import-dialog').waitFor({state:'visible'});await targets(page,'button','#import-dialog .form-actions');
      if(compact) {
        const boxes=await page.locator('#import-dialog .form-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
        assert(boxes[2].top>=Math.max(boxes[0].bottom,boxes[1].bottom),'Destructive import stays on its own row');
      }
      await page.screenshot({path:path.join(out,`${width}x${height}-import.png`)});await page.locator('#cancel-import').click();

      await page.locator('#mobile-search-open').click();await page.locator('#relationship-a').selectOption('a',{force:true});await page.locator('#relationship-b').selectOption('b',{force:true});await page.locator('#relationship-search [type=submit]').click();
      await targets(page,'button','#relationship-summary');await page.locator('.relationship-result-details').click();await page.locator('#relationship-result-sheet-close').click();
      assert(await page.locator('#relationship-summary').isVisible(),'Closing details retains the query');
      await page.locator('.relationship-result-end').click();assert(await page.locator('#relationship-summary').isHidden(),'End clears the query');

      // Test the effective hit area outside the small visible + circle.
      await page.evaluate(()=>{document.getElementById('tree-zoom-value').click();document.getElementById('tree-zoom-out').click();});await frames(page);
      const plus=page.locator('.intermediate-node').first();assert(await plus.count());await plus.evaluate(el=>el.scrollIntoView({block:'center',inline:'center'}));await frames(page);
      assert(await plus.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2+20,r.y+r.height/2)?.closest('.intermediate-node')===el;}),'The + target extends at least 20 screen pixels from its center');

      await page.locator('#show-member-map').click();await page.locator('.member-map-layers>button').waitFor();
      assert.match(await page.locator('#member-map-status').innerText(),/待定位 1/);await page.locator('#member-map-status').click();
      assert.match(await page.locator('[data-correct-person=u]').innerText(),/修正/);
      assert.match(await page.locator('.member-map-unlocated .map-text-action').last().innerText(),/重新查詢/);
      await page.evaluate(()=>{window.originalLocationState=FamilyMemberLocations.state;FamilyMemberLocations.state=()=>({pending:true,owner:false});dispatchEvent(new Event('familylocationstatus'));});
      assert(await page.locator('#member-map-takeover').isVisible());assert.equal(await page.locator('#member-map-takeover').innerText(),'由此裝置接手定位');
      await page.evaluate(()=>{FamilyMemberLocations.state=window.originalLocationState;dispatchEvent(new Event('familylocationstatus'));});
      await page.locator('[data-correct-person=u]').click();assert.equal(await page.locator('#location-mode-search').innerText(),'搜尋地點');assert.equal(await page.locator('#location-mode-map').innerText(),'地圖指定');
      await page.locator('#location-mode-map').click();assert.equal(await page.locator('#location-mode-map').getAttribute('aria-pressed'),'true');await targets(page,'button','.location-correction-modes');
      await page.screenshot({path:path.join(out,`${width}x${height}-map.png`)});await page.locator('#close-member-map').click();

      await page.evaluate(()=>document.getElementById('export-diagram').click());await page.waitForFunction(()=>!document.getElementById('tree-output-svg').disabled);
      await page.locator('#tree-output-original').click();assert.equal(await page.locator('#tree-output-original').getAttribute('aria-pressed'),'true');
      await page.locator('#tree-output-fit').click();assert.equal(await page.locator('#tree-output-fit').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#tree-output-original').getAttribute('aria-pressed'),'false');
      await targets(page,'button','.tree-output-preview-mode');
      const popupPromise=page.waitForEvent('popup');await page.locator('#tree-output-print').click();const popup=await popupPromise;await popup.waitForLoadState();
      const print=await popup.locator('#print-document').boundingBox();assert.equal(print.height,44);assert(print.x>=0&&print.x+print.width<=width);
      await popup.screenshot({path:path.join(out,`${width}x${height}-print.png`)});await popup.close();await page.locator('#tree-output-dialog [data-close]').click();
      if(compact) {
        await page.addStyleTag({content:'.tree-control-short,.details-action__label,.detail-nav-label{font-size:18px!important}'});
        await page.evaluate(()=>dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'a',options:{expandDetails:true}}})));await frames(page);
        await targets(page,'button','.page-header');await targets(page,'button','.workspace-toolbar');
        await targets(page,'button','.relationship-details__navigation');await targets(page,':scope>button,:scope>details>summary','.relationship-details__actions');
        await page.locator('.details-close').click();
      }
      await page.evaluate(()=>document.getElementById('family-title').textContent='陳');await frames(page);
      assert.equal(await page.locator('#family-title').getAttribute('data-truncated'),'false','An untruncated name has no disclosure cue');
      assert.equal(await page.evaluate(()=>JSON.stringify(FamilyApp.snapshot().data)),initial,'Navigation and previews never mutate the family');
      assert.deepEqual(errors,[]);console.log(`PASS buttons ${useWebKit?'webkit':'chromium'} ${width}x${height}`);await context.close();
    }
    console.log(`Screenshots: ${out}`);
  } finally {
    await browser?.close();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
    assert(path.basename(temp).startsWith('family-buttons-'));
    await fs.rm(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
