const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-actions-'));
  const person = (id, name, gender, order, relationships=[]) => ({id,name,gender,siblingOrder:order,relationships,location:'',position:''});
  const data = {schemaVersion:2,people:[person('A','陳氏家族名字很長的年長成員甲','M',2),{...person('B','陳氏家族名字很長的年幼成員乙','F',3,[{type:'sibling',personId:'A'}]),notes:'成員備註可從詳情閱讀'},person('C','另一位成員','U',null)]};
  const dataFile = path.join(dir,'family.json'); await fs.writeFile(dataFile,JSON.stringify(data));
  const server = createFamilyServer({dataFile}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
    for (const [width,height,touch] of [[1440,900,false],[1200,900,false],[1280,900,false],[918,884,false],[320,740,true],[360,800,true],[390,844,true],[700,1000,true],[568,320,true],[844,390,true],[667,375,false],[1024,768,true]]) {
      const context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch});
      const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(()=>window.FamilyEditor?.snapshot() && document.querySelector('.person'));
      const initialData = await fs.readFile(dataFile,'utf8');
      const compactLayout = width<=700 || (width<=950 && height<=520);
      assert.equal(await page.locator('.workspace-toolbar__scope #family-filter').count(),compactLayout?0:1,'Existing filter moves between toolbar regions without cloning');
      assert.equal(await page.locator('#family-filter').count(),1);
      const scope = page.locator('.family-scope-select');
      assert.equal(await scope.count(),1);
      await scope.locator('.select-trigger').focus();
      await page.keyboard.press('ArrowDown');
      const scopePopup = page.locator('.select-dropdown:popover-open');
      assert.equal(await scopePopup.getAttribute('aria-label'),'顯示範圍');
      assert.equal(await scopePopup.locator('[role=option][aria-selected=true]').textContent(),'所有關係');
      assert(await scopePopup.locator('.select-search').evaluate(input=>parseFloat(getComputedStyle(input).fontSize)>=16));
      const popupBounds=await scopePopup.boundingBox();
      assert(popupBounds.x>=0&&popupBounds.y>=0&&popupBounds.x+popupBounds.width<=width&&popupBounds.y+popupBounds.height<=height);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('.family-scope-select')!==null),true);
      assert.equal(await page.locator('#family-filter').inputValue(),'');
      if(width===390) {
        await page.setViewportSize({width:1440,height:900});
        await page.waitForFunction(()=>document.querySelector('.workspace-toolbar__scope .family-scope-select #family-filter'));
        await page.setViewportSize({width,height});
        await page.waitForFunction(()=>document.querySelector('.tree-controls .family-scope-select #family-filter'));
        assert.equal(await page.locator('#family-filter').count(),1);
      }
      const noteCard=page.locator('.person[data-person-id="B"]');
      await noteCard.focus();
      await noteCard.hover();
      await page.waitForTimeout(400);
      if(touch) {
        assert.equal(await page.locator('#member-tooltip').isVisible(),false,'Touch hover/focus must not display card notes');
        assert.equal(await noteCard.getAttribute('aria-describedby'),null);
      } else {
        assert.equal(await page.locator('#member-tooltip').isVisible(),true,'Mouse/keyboard notes stay available');
      }
      await scope.locator('.select-trigger').focus();
      await page.mouse.move(0,0);
      await page.locator('#member-tooltip').waitFor({state:'hidden'});
      const arrows = await page.locator('select:not([multiple]),.select-trigger').evaluateAll(elements=>elements.map(el=>({image:getComputedStyle(el).backgroundImage,size:getComputedStyle(el).backgroundSize})));
      for(const arrow of arrows) { assert.match(arrow.image,/M1 1.5 6 6.5l5-5/); assert.equal(arrow.size,'12px 8px'); }
      assert.equal(await page.locator('.tree-controls button[aria-label="更多功能"]:visible').count(),1,'Each viewport must expose exactly one More button');
      const headerButtons = await page.locator('.page-header button').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().width&&getComputedStyle(b).display!=='none').map(b=>({id:b.id,h:b.getBoundingClientRect().height})));
      for(const b of headerButtons) assert.equal(b.h,44,JSON.stringify({width,height,b}));
      if(!compactLayout) {
        assert(await page.locator('#desktop-more-open').isVisible());
        assert.equal(await page.locator('#landscape-more-open').isVisible(),false);
        await page.locator('#desktop-more-open').click();
        for(const action of ['family-name','cloud','import','export']) assert(await page.locator(`[data-action="${action}"]`).isVisible(),action);
        for(const action of ['canvas-names','legend','relationship']) assert.equal(await page.locator(`[data-action="${action}"]`).isVisible(),false,`Desktop More must not duplicate ${action}`);
        await page.locator('#landscape-more-close').click();
        assert.equal(await page.evaluate(()=>document.activeElement.id),'desktop-more-open');
        if(width<1200) {
          assert(await page.locator('#mobile-search-open').isVisible());
          await page.locator('#mobile-search-open').click();
          assert(await page.locator('.relationship-sheet #relationship-search').isVisible());
          const hintHeight=await page.locator('.relationship-sheet .relationship-direction').evaluate(el=>el.getBoundingClientRect().height);
          assert(hintHeight<60,'Query direction must size to its text rather than reserving a tall flex basis');
          const sheetHeight=await page.locator('.relationship-sheet').evaluate(el=>el.getBoundingClientRect().height);
          assert(sheetHeight<400,'Desktop query dialog should not contain a large empty region');
          await page.locator('#relationship-sheet-close').click();
        }
      }
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'A',options:{expandDetails:true}}})));
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
      for(const b of layout.buttons) assert.equal(b.h,44,JSON.stringify({width,height,b}));
      const iconSizes=await page.locator('#relationship-details .details-icon:not(.details-action)').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().width&&getComputedStyle(b).visibility!=='hidden').map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,svg:b.querySelector('svg').getBoundingClientRect().width})));
      for(const icon of iconSizes) assert.deepEqual(icon,{w:44,h:44,svg:20});
      if(!compactLayout) {
        const treeRight=await page.locator('.tree').evaluate(el=>el.getBoundingClientRect().right);
        assert(treeRight<=layout.left+1,'Docked inspector must not cover the canvas');
        const narrowWidth=await page.locator('.tree').evaluate(el=>el.clientWidth);
        const beforeCollapse=await page.locator('.person[data-person-id=B]').evaluate(el=>{const r=el.getBoundingClientRect(),v=el.closest('.tree').getBoundingClientRect();return (r.left+r.width/2-v.left)/v.width;});
        await page.locator('.details-collapse').click();
        await page.waitForFunction(previous=>document.querySelector('.tree').clientWidth>previous,narrowWidth);
        await page.waitForTimeout(100);
        await page.locator('.relationship-details__tab').click();
        await page.waitForFunction(previous=>document.querySelector('.tree').clientWidth===previous,narrowWidth);
        await page.waitForTimeout(100);
        const afterExpand=await page.locator('.person[data-person-id=B]').evaluate(el=>{const r=el.getBoundingClientRect(),v=el.closest('.tree').getBoundingClientRect();return (r.left+r.width/2-v.left)/v.width;});
        assert(Math.abs(beforeCollapse-afterExpand)<.03,JSON.stringify({reason:'Dock collapse/expand preserves the selected member anchor',width,beforeCollapse,afterExpand,narrowWidth}));
        await page.locator('.details-close').click();
        await page.waitForTimeout(100);
        const beforeQuery = await page.locator('.tree').evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
        if(width<1200) await page.locator('#mobile-search-open').click();
        await page.locator('#relationship-a').selectOption('A',{force:true});
        await page.locator('#relationship-b').selectOption('B',{force:true});
        await page.locator('#relationship-search [type=submit]').click();
        assert(await page.locator('#relationship-summary').isVisible());
        await page.locator('.person[data-person-id=B]').click();
        await page.waitForTimeout(100);
        assert(await page.locator('#relationship-details').isVisible());
        const queryCanvas = await page.locator('.tree').boundingBox();
        const queryPanel = await page.locator('#relationship-details').boundingBox();
        assert(queryCanvas.x+queryCanvas.width<=queryPanel.x+1,'Query canvas also excludes the docked inspector');
        if(width<1200) await page.locator('#mobile-search-end').click();
        else await page.locator('#relationship-reset').click();
        await page.waitForTimeout(100);
        const afterQuery = await page.locator('.tree').evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
        assert(Math.abs(beforeQuery.left-afterQuery.left)<=2&&Math.abs(beforeQuery.top-afterQuery.top)<=2,'Leaving comparison restores the original full-tree viewport');
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'B',options:{expandDetails:true}}})));
      }
      assert.equal(await fs.readFile(dataFile,'utf8'),initialData,'Pure layout and navigation must not write family data');
      if(compact) {
        assert(layout.topHeight<=120,JSON.stringify(layout));
        if(width>350) assert(layout.titleVisible&&layout.titleWidth>=30,JSON.stringify(layout));
        assert.equal(await page.locator('.edit-member .details-action__label').isVisible(),true);
        assert.equal(await page.locator('.add-relative .details-action__label').isVisible(),true);
        assert.equal(await page.locator('.query-relationship').isVisible(),false);
        assert.equal(await page.locator('.details-locate').isVisible(),false);
        assert(await page.locator('.relationship-details__more-summary').isVisible());
        await page.locator('.relationship-details__more-summary').click();
        assert(await page.locator('.query-relationship').isVisible());
        assert(await page.locator('.details-locate').isVisible());
        await page.locator('.relationship-details__more-summary').click();
        for(const b of layout.buttons) assert(b.w>=44&&b.h>=44&&b.x>=layout.left&&b.x+b.w<=layout.right+1,JSON.stringify(b));
        for(let i=0;i<layout.buttons.length;i++) for(let j=i+1;j<layout.buttons.length;j++) {const a=layout.buttons[i],b=layout.buttons[j];assert(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,'Overlapping action targets');}
      } else {
        assert(layout.titleVisible&&layout.titleWidth>=140,JSON.stringify(layout));
        const clipped=await page.locator('.details-action__label').evaluateAll(labels=>labels.some(label=>label.scrollWidth>label.clientWidth)); assert.equal(clipped,false,'Desktop action labels must fit');
      }
      await page.locator('#relationship-details').evaluate(async panel=>{await Promise.all(panel.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
      await page.screenshot({path:path.join(dir,`${width}-${height}-details.png`)});
      await page.locator('.add-relative').click();
      const picker=page.locator('.family-management-dialog'), close=picker.getByRole('button',{name:/^關閉/});
      await picker.evaluate(async dialog=>{await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
      assert.equal(await close.textContent(),''); assert.equal(await close.locator('svg').count(),1);
      if(touch) {const box=await close.boundingBox(); assert(box.width>=44&&box.height>=44);}
      const headerHeight=await picker.locator('.dialog-header').evaluate(el=>el.getBoundingClientRect().height); assert(headerHeight<=100,headerHeight);
      await close.click();
      if (compact) {
        await page.evaluate(()=>window.dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:'C',options:{expandDetails:true}}})));
        assert.equal(await page.locator('.query-relationship').count(),0,'Unlinked members must not expose a relationship-query action');
        const gap=await page.locator('.relationship-details__actions').evaluate(actions=>actions.querySelector('.add-relative').getBoundingClientRect().left-actions.querySelector('.edit-member').getBoundingClientRect().right);
        assert(gap>=4&&gap<=8,'High-frequency mobile actions should keep one compact gap');
      }
      await page.evaluate(()=>editFamilyMember('B'));
      await page.locator('#member-dialog').evaluate(async dialog=>{await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
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
      assert.equal(await page.locator('#member-dialog').evaluate(dialog=>dialog.open),false);
      await page.locator('#member-dialog').waitFor({state:'hidden'});
      assert.equal(await page.locator('#member-dialog').isVisible(),false);
      await page.evaluate(()=>editFamilyMember('B')); assert.equal(await page.locator('.relation-row').count(),1); assert.equal(await page.locator('.relation-removal-status button').count(),0);
      assert.deepEqual(errors,[]); console.log(`PASS ${width}x${height}: titles, icons, touch targets, collapsed remove/undo, focus, unsaved-close guard`);
      await context.close();
    }
    console.log('Screenshots: '+dir);
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
