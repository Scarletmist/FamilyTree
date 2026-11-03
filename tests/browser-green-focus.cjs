// Pixel checks catch outlines clipped by a scrollport or painted over by chrome.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');

function pixels(png) {
  let width, height, channels; const parts = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at), type = png.toString('ascii',at+4,at+8), bytes = png.subarray(at+8,at+8+size);
    if (type === 'IHDR') { width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);assert.equal(bytes[8],8);channels=bytes[9]===6?4:bytes[9]===2?3:0;assert(channels); }
    if (type === 'IDAT') parts.push(bytes);
    at += size + 12;
  }
  const raw=zlib.inflateSync(Buffer.concat(parts)), stride=width*channels, output=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];
    for(let x=0;x<stride;x++) {
      const a=x>=channels?output[y*stride+x-channels]:0,b=y?output[(y-1)*stride+x]:0,c=y&&x>=channels?output[(y-1)*stride+x-channels]:0;
      const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];assert.notEqual(predictor,undefined);
      output[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return (x,y)=>{x=Math.floor(x);y=Math.floor(y);return x>=0&&x<width&&y>=0&&y<height?[...output.subarray(y*stride+x*channels,y*stride+x*channels+3)]:[];};
}
const person=(id,name,relationships=[],extra={})=>({id,name,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent=personId=>({type:'parent',personId,kind:'親生'});
const fixture={schemaVersion:3,familyName:'綠色選取與完整邊界',locationLookupDeviceId:'another-device',people:[
  person('g','祖母'),person('p','父親',[parent('g')]),person('m','母親'),
  person('a','目前查看的成員',[parent('p'),parent('m'),{type:'spouse',personId:'w'},{type:'teacher',personId:'t'}],{notes:'人物備註。'.repeat(40),location:'新竹市',geocode:{provider:'nominatim',query:'新竹市',status:'resolved',lat:24.8,lon:120.96,checkedAt:1,displayName:'新竹市',osmType:'node',osmId:'123'}}),
  person('b','手足',[parent('p'),parent('m')]),person('w','配偶'),person('c','子女',[parent('a')]),person('t','老師'),person('s','學生',[{type:'teacher',personId:'a'}])
]};

(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'family-green-focus-')),file=path.join(temp,'family.json');
  await fs.writeFile(file,JSON.stringify(fixture));
  const out=path.resolve(process.env.GREEN_FOCUS_OUTPUT||'.codebase-memory/phase5-results/green-focus');await fs.mkdir(out,{recursive:true});
  const server=createFamilyServer({dataFile:file});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/`,html=await renderFamilyTreeHtml({browserStorage:true});
  let browser;const results=[];
  try {
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
    for(const mode of ['api','static']) for(const [width,height] of [[1440,900],[1024,768],[390,844],[320,568],[844,390]]) {
      if(process.env.TEST_VIEWPORT&&process.env.TEST_VIEWPORT!==`${width}x${height}`)continue;
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<1000,reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await context.route(/^https:\/\/(tile\.openstreetmap\.org|mt[0-3]\.google\.com)\//,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4ebdd"/></svg>'}));
      await context.route('https://nominatim.openstreetmap.org/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
      await context.route('https://accounts.google.com/**',route=>route.abort());
      await context.addInitScript(()=>localStorage.setItem('family-tree:canvas-guide:v1','seen'));
      if(mode==='static'){
        await context.route(base,route=>route.fulfill({contentType:'text/html',body:html}));
        await context.addInitScript(data=>localStorage.setItem('family-static-v1:/',JSON.stringify({data,version:'green-focus-test'})),fixture);
      }
      await page.goto(base);await page.waitForFunction(()=>FamilyApp?.snapshot?.()&&!document.getElementById('add-member').disabled);
      const original=await page.evaluate(()=>JSON.stringify(FamilyApp.snapshot().data));
      let checks=0;
      async function audit(selector,scene,{scroll=true}={}){
        const nodes=page.locator(selector).filter({visible:true});
        for(let i=0;i<await nodes.count();i++){
          const node=nodes.nth(i);if(await node.isDisabled())continue;
          await page.keyboard.press('Tab');
          if(scroll)await node.evaluate(el=>el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));
          await node.evaluate(el=>el.focus({preventScroll:true}));
          // Let native focus scrolling and sticky-layout observers reach paint
          // before comparing the screenshot with the element's screen bounds.
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const state=await node.evaluate(el=>{
            const s=getComputedStyle(el),r=el.getBoundingClientRect();
            return {name:el.getAttribute('aria-label')||el.id||el.textContent,rect:r.toJSON(),scaleX:r.width/(el.offsetWidth||el.clientWidth||r.width),scaleY:r.height/(el.offsetHeight||el.clientHeight||r.height),color:s.outlineColor.match(/[\d.]+/g)?.slice(0,3).map(Number),line:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),focus:el.matches(':focus-visible'),style:s.outlineStyle,transform:s.transform};
          });
          const r=state.rect;
          if(!state.focus||state.style==='none'||!state.line)throw new Error(`${scene}: missing focus indicator: ${state.name}`);
          const clip={x:Math.max(0,Math.floor(r.left-8)),y:Math.max(0,Math.floor(r.top-8))};
          clip.width=Math.min(width,Math.ceil(r.right+8))-clip.x;clip.height=Math.min(height,Math.ceil(r.bottom+8))-clip.y;
          if(clip.width<=0||clip.height<=0){
            await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({mode,width,height,scene,state,clip},null,2));
            await page.screenshot({path:path.join(out,'failure.png')});
            assert.fail(`${scene}: focused target outside viewport: ${JSON.stringify(state)}`);
          }
          const png=await page.screenshot({clip,animations:'disabled'}),pixel=pixels(png),distanceX=(state.offset+state.line/2)*state.scaleX,distanceY=(state.offset+state.line/2)*state.scaleY;
          const side={left:[],right:[],top:[],bottom:[]};
          for(const t of [.45,.5,.55]){
            side.left.push([r.left-distanceX,r.top+r.height*t]);side.right.push([r.right+distanceX,r.top+r.height*t]);
            side.top.push([r.left+r.width*t,r.top-distanceY]);side.bottom.push([r.left+r.width*t,r.bottom+distanceY]);
          }
          const missing=Object.entries(side).filter(([,points])=>!points.some(([x,y])=>{const rgb=pixel(x-clip.x,y-clip.y);return rgb.length===3&&rgb.every((v,k)=>Math.abs(v-state.color[k])<35);})).map(([name])=>name);
          const covered=await node.evaluate(el=>{
            const r=el.getBoundingClientRect(),points=[[.5,.5],[.5,.15],[.5,.85],[.15,.5],[.85,.5]];
            return points.filter(([x,y])=>{const top=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return top&&!el.contains(top);});
          });
          if(missing.length||covered.length){
            await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({mode,width,height,scene,state,missing,covered},null,2));
            await page.screenshot({path:path.join(out,'failure.png')});
            assert.fail(`${mode} ${width}×${height} ${scene} ${state.name}: hidden focus edges ${missing}; covered points ${JSON.stringify(covered)}`);
          }
          checks++;
        }
      }
      const compact=width<=700||(width<=950&&height<=520);
      const greenChrome=await page.locator('.tree-minimap__viewport,.tree-minimap__selected').evaluateAll(nodes=>nodes.length===2&&nodes.every(node=>{
        const rgb=getComputedStyle(node).stroke.match(/\d+/g).slice(0,3).map(Number);return rgb[1]>rgb[0]&&rgb[1]>rgb[2];
      }));assert(greenChrome,'Minimap selection and viewport use the green theme');
      await audit('.page-header button:not([hidden]),.workspace-toolbar button:not([hidden])','global toolbar');
      await audit('.tree-zoom-controls button,.mobile-tree-fit,.tree-minimap button,.tree-minimap__surface','canvas navigation');
      await page.locator('#show-member-list').click();
      await audit('#member-list-search,.member-list-filter,#close-member-list','member list');
      await audit('#member-list-body tr:first-child,#member-list-body tr:last-child','member list boundaries');
      await page.locator('#close-member-list').click();
      await page.evaluate(()=>dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'a',options:{expandDetails:true}}})));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await audit('.person[aria-pressed=true]','selected person',{scroll:false});
      await audit('.relationship-details__navigation button,.relationship-details__actions>button,.relationship-details__more-summary','inspector actions');
      await audit('.relationship-category-nav button:first-child,.relationship-category-nav button:last-child','scrolling categories');
      await page.locator('.relationship-details__more-summary').click();
      await audit('.relationship-details__more-body button','inspector menu');
      await page.locator('.relationship-details__more-summary').click();
      await audit('.person[aria-pressed=true]','selected person after inspector browsing',{scroll:false});
      const scopeState=await page.locator('.family-scope-select .select-trigger').evaluate(el=>{const style=getComputedStyle(el),range=document.createRange();range.selectNodeContents(el);return {text:el.textContent,scrollLeft:el.scrollLeft,scrollTop:el.scrollTop,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,color:style.color,fontSize:style.fontSize,lineHeight:style.lineHeight,opacity:style.opacity,textRect:range.getBoundingClientRect().toJSON(),rect:el.getBoundingClientRect().toJSON()};});
      await fs.writeFile(path.join(out,`${mode}-${width}x${height}-scope.json`),JSON.stringify(scopeState));
      await page.screenshot({path:path.join(out,`${mode}-${width}x${height}-details.png`)});
      if(compact){
        await page.locator('.detail-expand').click();
        await audit('.relationship-details__navigation button,.relationship-details__actions>button,.relationship-category-nav button:first-child,.relationship-category-nav button:last-child','full reading');
        await page.locator('.detail-expand').click();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await audit('.person[aria-pressed=true]','return from reading',{scroll:false});
      }
      await page.locator('.details-close').click();
      await page.locator('#add-member').click();
      await audit('#member-dialog .dialog-header button,#member-name,#member-dialog .select-trigger,#member-dialog summary,#member-dialog .form-actions button','member form');
      if(!await page.locator('.member-optional-fields').evaluate(el=>el.open))await page.locator('.member-optional-fields>summary').click();
      await audit('#member-map-hidden,#member-location,#member-notes','optional fields');
      await page.locator('#member-map-hidden').check();await audit('#member-map-hidden','checked checkbox');await page.locator('#member-map-hidden').uncheck();
      await page.locator('#add-relation').click();
      await audit('.relation-row button,.relation-row .select-trigger','relation form');
      await page.locator('.relation-row .remove-relation').click();await page.locator('#cancel-member').click();
      const more=page.locator(compact?(width>height?'#landscape-more-open':'#portrait-more-open'):'#desktop-more-open');
      await more.click();await audit('.workspace-menu-search,.workspace-menu-group>summary,.workspace-menu-group button','More menu');
      await page.locator('#landscape-more-close').click();
      await page.locator('#mobile-search-open').click();
      await audit('.relationship-sheet button,.relationship-sheet .select-trigger','relationship query');
      await page.locator('#relationship-a').selectOption('a',{force:true});await page.locator('#relationship-b').selectOption('b',{force:true});
      await page.locator('#relationship-search [type=submit]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await audit('.person.pair-a,.person.pair-b','query endpoints',{scroll:false});
      const queryBorder=await page.locator('.person.pair-b').evaluate(el=>getComputedStyle(el).boxShadow);
      assert(queryBorder.includes('inset'),'Query endpoint selection is painted inside the card');
      const queryColor=queryBorder.match(/\d+/g).slice(0,3).map(Number);assert(queryColor[1]>queryColor[0]&&queryColor[1]>queryColor[2]);
      await page.locator('.relationship-result-end').click();
      await page.locator('#show-member-map').click();await page.locator('.member-map-layers>button').waitFor();
      await audit('.member-map-header button,.member-map-zoom button,.member-map-layers>button,#member-map-filter','map controls');
      await page.locator('#close-member-map').click();
      const changed=structuredClone(fixture);changed.people[0].notes='匯入差異';
      await page.locator('#import-file').setInputFiles({name:'focus.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});
      await audit('#import-dialog .form-actions button,#import-dialog .dialog-header button','import footer');
      await page.locator('#cancel-import').click();
      await page.evaluate(()=>document.getElementById('export-diagram').click());await page.waitForFunction(()=>!document.getElementById('tree-output-svg').disabled);
      await audit('.tree-output-dialog button,.tree-output-dialog summary,.tree-output-dialog input,.tree-output-dialog select','diagram output');
      await page.locator('.tree-output-dialog').getByRole('button',{name:'關閉族譜輸出',exact:true}).click();
      const accent=await page.locator('#add-member').evaluate(el=>getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number));
      assert(accent[1]>accent[0]&&accent[1]>accent[2],'Primary actions use green');
      const nativeAccent=await page.locator('html').evaluate(el=>getComputedStyle(el).accentColor.match(/\d+/g).map(Number));
      assert(nativeAccent[1]>nativeAccent[0]&&nativeAccent[1]>nativeAccent[2],'Native controls inherit green');
      assert.equal(await page.evaluate(()=>JSON.stringify(FamilyApp.snapshot().data)),original);assert.deepEqual(errors,[]);
      results.push({mode,width,height,checks,status:'passed'});console.log(`PASS ${mode} ${width}×${height}: ${checks} controls with all four focus edges painted and hit areas unobscured`);
      await context.close();
    }
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,totalChecks:results.reduce((sum,r)=>sum+r.checks,0),physicalDevices:'not_run'},null,2));
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
