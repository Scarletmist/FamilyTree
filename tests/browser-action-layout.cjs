const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../server.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-actions-'));
  const person = (id, name, gender, order, relationships=[]) => ({id,name,gender,siblingOrder:order,relationships,location:'',position:''});
  const data = {schemaVersion:2,people:[person('A','陳氏家族名字很長的年長成員甲','M',2),person('B','陳氏家族名字很長的年幼成員乙','F',3,[{type:'sibling',personId:'A'}]),person('C','另一位成員','U',null)]};
  const dataFile = path.join(dir,'family.json'); await fs.writeFile(dataFile,JSON.stringify(data));
  const server = createFamilyServer({dataFile}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
    for (const [width,height,touch] of [[1280,900,false],[320,740,true],[360,800,true],[390,844,true],[700,1000,true],[568,320,true],[844,390,true],[1024,768,true]]) {
      const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
      const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(()=>window.FamilyEditor?.snapshot());
      await page.evaluate(()=>selectFamilyMember('A',{expandDetails:true}));
      const compact=await page.evaluate(()=>matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)').matches);
      if (compact) {
        assert.equal(await page.locator('.details-back--placeholder').evaluate(el=>getComputedStyle(el).display),'none','Unused back control must not reserve horizontal space');
        assert(await page.locator('#relationship-details-title').isVisible(),'Without history the title should remain visible even on narrow phones');
      }
      await page.locator('.relationship-entry__person[data-person-id=B]').click();
      if(await page.locator('#relationship-details').getAttribute('data-collapsed')==='true') await page.locator('.relationship-details__tab').click();
      const layout=await page.locator('#relationship-details').evaluate(panel=>{
        const top=panel.querySelector('.relationship-details__top'), bounds=panel.getBoundingClientRect();
        const visible=el=>getComputedStyle(el).visibility!=='hidden'&&el.getBoundingClientRect().width>0;
        const buttons=[...top.querySelectorAll('button')].filter(visible).map(el=>({label:el.getAttribute('aria-label'),x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
        const title=panel.querySelector('h2');
        return {width:bounds.width,overflow:panel.scrollWidth>panel.clientWidth,titleVisible:visible(title),titleWidth:title.getBoundingClientRect().width,topHeight:top.getBoundingClientRect().height,buttons,left:bounds.left,right:bounds.right};
      });
      assert.equal(layout.overflow,false,JSON.stringify({width,height,layout}));
      if(compact) {
        assert(layout.topHeight<=52,JSON.stringify(layout));
        if(width>350) assert(layout.titleVisible&&layout.titleWidth>=30,JSON.stringify(layout));
        const gaps=await page.locator('.relationship-details__top').evaluate(top=>{
          const box=s=>top.querySelector(s).getBoundingClientRect();
          const edit=box('.edit-member'),query=box('.query-relationship'),add=box('.add-relative'),collapse=box('.details-collapse'),close=box('.details-close');
          return [query.left-edit.right,add.left-query.right,close.left-collapse.right];
        });
        assert(gaps.every(g=>g>=1&&g<=3),'Icons must be tightly grouped, not distributed into equal-width columns: '+gaps);
        const centers=layout.buttons.map(b=>b.y+b.h/2); assert(Math.max(...centers)-Math.min(...centers)<1,'All mobile controls belong in one row');
        assert.equal(await page.locator('.add-relative .details-action__label').isVisible(),false);
        for(const b of layout.buttons) assert(b.w>=44&&b.h>=44&&b.x>=layout.left&&b.x+b.w<=layout.right+1,JSON.stringify(b));
        for(let i=0;i<layout.buttons.length;i++) for(let j=i+1;j<layout.buttons.length;j++) {const a=layout.buttons[i],b=layout.buttons[j];assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,'Overlapping action targets');}
      } else {
        assert(layout.titleVisible&&layout.titleWidth>=140,JSON.stringify(layout));
        const clipped=await page.locator('.details-action__label').evaluateAll(labels=>labels.some(label=>label.scrollWidth>label.clientWidth)); assert.equal(clipped,false,'Desktop action labels must fit');
      }
      await page.screenshot({path:path.join(dir,`${width}-${height}-details.png`)});
      await page.locator('.add-relative').click();
      const picker=page.locator('.family-management-dialog'), close=picker.getByRole('button',{name:/^關閉/});
      assert.equal(await close.textContent(),''); assert.equal(await close.locator('svg').count(),1);
      if(touch) {const box=await close.boundingBox(); assert(box.width>=44&&box.height>=44);}
      const headerHeight=await picker.locator('.dialog-header').evaluate(el=>el.getBoundingClientRect().height); assert(headerHeight<=100,headerHeight);
      await close.click();
      if (compact) {
        await page.evaluate(()=>selectFamilyMember('C',{expandDetails:true}));
        assert.equal(await page.locator('.details-query-placeholder').evaluate(el=>getComputedStyle(el).display),'none','Unlinked members must not leave an empty query slot');
        const gap=await page.locator('.relationship-details__top').evaluate(top=>top.querySelector('.add-relative').getBoundingClientRect().left-top.querySelector('.edit-member').getBoundingClientRect().right);
        assert(gap>=1&&gap<=3,'Removing the query action must close the gap');
      }
      await page.evaluate(()=>editFamilyMember('B'));
      const row=page.locator('.relation-row').first(); assert.equal(await row.getAttribute('data-expanded'),'false');
      assert(await row.locator('.remove-relation').isVisible()); assert.match(await row.locator('.remove-relation').getAttribute('aria-label'),/年長成員甲/);
      if(compact) {
        for(const selector of ['.relation-row__toggle','.remove-relation']) {const box=await row.locator(selector).boundingBox();assert.equal(box.width,44);assert.equal(box.height,44);}
        assert.equal(await row.locator('.remove-relation .relation-row__action-label').isVisible(),false);
      }
      await row.locator('.remove-relation').click(); assert.equal(await page.locator('.relation-row').count(),0);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'add-relation');
      assert.match(await page.locator('.relation-removal-status').textContent(),/儲存後才會套用/);
      await page.getByRole('button',{name:'復原剛移除的關係'}).click(); assert.equal(await page.locator('.relation-row').count(),1);
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('relation-row__toggle')),true);
      await page.screenshot({path:path.join(dir,`${width}-${height}-form.png`)});
      await page.locator('.remove-relation').click(); await page.locator('#close-member-dialog').click();
      assert(await page.locator('#unsaved-changes-dialog').isVisible()); await page.click('#discard-member-changes');
      assert.equal(await page.locator('#member-dialog').isVisible(),false);
      await page.evaluate(()=>editFamilyMember('B')); assert.equal(await page.locator('.relation-row').count(),1); assert.equal(await page.locator('.relation-removal-status button').count(),0);
      assert.deepEqual(errors,[]); console.log(`PASS ${width}x${height}: titles, icons, touch targets, collapsed remove/undo, focus, unsaved-close guard`);
      await context.close();
    }
    console.log('Screenshots: '+dir);
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
