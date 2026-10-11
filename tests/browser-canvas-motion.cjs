const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-camera-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.copyFile(path.join(__dirname, '../fixtures/family.json'), dataFile);
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const [width,height,touch] of [[1440,900,false],[918,884,false],[390,844,true],[844,390,true]]) {
      for (const reducedMotion of ['no-preference','reduce']) {
        const context = await browser.newContext({ viewport:{width,height}, isMobile:touch, hasTouch:touch, reducedMotion });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => FamilyApp?.graph?.() && document.querySelector('.person'));
        await page.waitForFunction(() => !document.getElementById('kinship-status').textContent);
        const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
        const activate = async locator => touch ? locator.tap() : locator.click();
        const settle = () => page.waitForTimeout(360);
        if (!touch) {
          const legend = page.locator('.legend-panel');
          const arrow = () => legend.locator('summary').evaluate(element => getComputedStyle(element,'::after').content);
          if (await legend.evaluate(element => element.open)) await legend.locator('summary').click();
          assert.equal(await arrow(), '"▾"');
          await legend.locator('summary').click(); assert.equal(await arrow(), '"▴"');
          await legend.locator('summary').click(); assert.equal(await arrow(), '"▾"');
        }
        const farId = await page.evaluate(() => {
          const view = document.querySelector('.tree').getBoundingClientRect();
          const distance = node => { const rect=node.getBoundingClientRect(); return Math.hypot(rect.left-view.left,rect.top-view.top); };
          return [...document.querySelectorAll('.person')].sort((a,b)=>distance(b)-distance(a))[0].dataset.personId;
        });
        // The actual member list routes into the same camera as relative browsing.
        await activate(page.locator('#show-member-list'));
        await page.evaluate(() => {
          window.savedSvg = document.getElementById('tree-connectors');
          window.lineTransitions = [];
          document.addEventListener('transitionrun', event => {
            if (event.propertyName === 'opacity' && event.target.hasAttribute('data-people')) window.lineTransitions.push(event.target);
          });
          window.cameraSamples = [];
          window.sampleCamera = () => {
            const view=document.querySelector('.tree');
            cameraSamples.push([view.scrollLeft,view.scrollTop]);
            window.cameraSampler=requestAnimationFrame(sampleCamera);
          };
          sampleCamera();
        });
        await activate(page.locator(`#member-list-body tr[data-person-id="${farId}"] .member-list-name-button`));
        await settle();
        const movement = await page.evaluate(() => {
          cancelAnimationFrame(cameraSampler);
          return { positions:new Set(cameraSamples.map(point=>point.map(value=>Math.round(value)).join(','))).size,
            sameSvg:savedSvg===document.getElementById('tree-connectors'), fading:lineTransitions.length };
        });
        assert(movement.sameSvg, 'Member selection must preserve connector elements');
        assert(movement.fading > 0, 'Non-selected connectors must actually fade');
        if (reducedMotion === 'no-preference') assert(movement.positions > 3, JSON.stringify(movement));
        else assert(movement.positions <= 3, 'Reduced motion should locate immediately');
        const visibleMember = async id => {
          const bounds = await page.locator(`.person[data-person-id="${id}"]`).evaluate(node => {
            const rect=node.getBoundingClientRect(), view=document.querySelector('.tree').getBoundingClientRect();
            const panel=document.getElementById('relationship-details').getBoundingClientRect();
            const bottom=panel.width>view.width/2 && panel.top>view.top && panel.top<view.bottom ? panel.top : view.bottom;
            return { x:rect.left+rect.width/2,y:rect.top+rect.height/2,left:view.left,right:view.right,top:view.top,bottom };
          });
          assert(bounds.x>=bounds.left && bounds.x<=bounds.right && bounds.y>=bounds.top && bounds.y<=bounds.bottom, JSON.stringify(bounds));
        };
        await visibleMember(farId);
        if (await page.locator('#relationship-details').getAttribute('data-collapsed') === 'true') {
          await activate(page.locator('.relationship-details__tab')); await settle();
        }
        const relative = page.locator('.relationship-entry__person').first();
        const relativeId = await relative.getAttribute('data-person-id');
        await page.evaluate(() => { window.lineTransitions=[]; });
        await activate(relative); await settle();
        assert(await page.evaluate(() => savedSvg===document.getElementById('tree-connectors')));
        assert(await page.evaluate(() => lineTransitions.length>0), 'Relative browsing must retain the fade');
        await visibleMember(relativeId);
        // Locate from a deliberately panned-away position, then interrupt it.
        await page.locator('.tree').evaluate(view=>view.scrollTo({left:0,top:0,behavior:'instant'}));
        const more = page.locator('.relationship-details__more-summary');
        if (!await page.locator('.details-locate').isVisible()) await activate(more);
        await activate(page.locator('.details-locate')); await settle();
        await visibleMember(relativeId);
        // Escape dismisses an open action menu before closing the inspector.
        // Start the dock-close checks with that menu already dismissed.
        if (await more.evaluate(node => node.closest('details').open)) await activate(more);
        // Desktop keeps the member browser open beside the inspector. Dismiss
        // it so Escape tests the inspector rather than another open dialog.
        if (await page.locator('#member-list-dialog').evaluate(dialog => dialog.open)) {
          await activate(page.locator('#close-member-list')); await settle();
        }
        if (!touch) {
          for (const closeAction of ['button','escape','background','collapsed']) {
            await page.evaluate(id => {
              document.documentElement.dataset.motionInput='pointer';
              dispatchEvent(new CustomEvent('familytreeselect',{detail:{id,options:{expandDetails:true}}}));
            }, relativeId);
            await settle();
            if (closeAction === 'collapsed') { await activate(page.locator('.details-collapse')); await settle(); }
            // Reproduce both an ordinary close and closing at the right edge,
            // where native scroll clamping would otherwise move the canvas.
            if (closeAction !== 'button') await page.locator('.tree').evaluate(view=>{view.scrollLeft=view.scrollWidth-view.clientWidth;});
            const snapshot = () => page.locator(`.person[data-person-id="${relativeId}"]`).evaluate(node=>{
              const rect=node.getBoundingClientRect(),view=node.closest('.tree');
              return {x:rect.left,y:rect.top,left:view.scrollLeft,top:view.scrollTop,width:view.clientWidth,scrollWidth:view.scrollWidth,spacer:document.getElementById('tree-zoom-spacer').style.width};
            });
            const beforeClose = await snapshot();
            if (closeAction === 'button') await activate(page.locator('.details-close'));
            else if (closeAction === 'escape' || closeAction === 'collapsed') await page.keyboard.press('Escape');
            else await page.locator('.tree').evaluate(view=>view.dispatchEvent(new MouseEvent('click',{bubbles:true})));
            await settle();
            const afterClose = await snapshot();
            if (closeAction === 'collapsed') assert.equal(afterClose.width, beforeClose.width);
            else assert(afterClose.width>beforeClose.width, JSON.stringify({reason:'Closing the dock should reveal more canvas',width,height,closeAction,beforeClose,afterClose}));
            for (const key of ['x','y','left','top']) assert(Math.abs(afterClose[key]-beforeClose[key])<2,
              JSON.stringify({closeAction,key,beforeClose,afterClose}));
            assert(await page.evaluate(()=>savedSvg===document.getElementById('tree-connectors')));
          }
        }
        const targetIds = await page.locator('.person').evaluateAll(nodes=>nodes.slice(-2).map(node=>node.dataset.personId));
        await page.evaluate(ids => {
          document.documentElement.dataset.motionInput='pointer';
          for (const id of ids) dispatchEvent(new CustomEvent('familytreeselect',{detail:{id,options:{expandDetails:true}}}));
        }, targetIds);
        await settle(); await visibleMember(targetIds[1]);
        await page.evaluate(id => {
          document.documentElement.dataset.motionInput='pointer';
          dispatchEvent(new CustomEvent('familytreeselect',{detail:{id}}));
        }, farId);
        await page.waitForTimeout(60);
        await page.locator('.tree').evaluate(view=>view.dispatchEvent(new WheelEvent('wheel',{bubbles:true})));
        const stopped = await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]);
        await settle();
        assert.deepEqual(await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]), stopped, 'User input must cancel camera movement');
        await page.evaluate(id => {
          document.documentElement.dataset.motionInput='pointer';
          dispatchEvent(new CustomEvent('familytreeselect',{detail:{id}}));
        }, relativeId);
        await page.waitForTimeout(60);
        await page.locator('.tree').evaluate(view => {
          const rect=view.getBoundingClientRect();
          for (const type of ['pointerdown','pointerup']) view.dispatchEvent(new PointerEvent(type,{
            bubbles:true,pointerId:99,pointerType:'mouse',isPrimary:true,button:0,clientX:rect.left+20,clientY:rect.top+20
          }));
        });
        const grabbed = await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]);
        await settle();
        assert.deepEqual(await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]), grabbed, 'Grabbing the canvas must cancel camera movement');
        await page.evaluate(id => {
          document.documentElement.dataset.motionInput='keyboard';
          dispatchEvent(new CustomEvent('familytreeselect',{detail:{id}}));
        }, relativeId);
        await page.waitForTimeout(60);
        const immediate = await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]);
        await settle();
        assert.deepEqual(await page.locator('.tree').evaluate(view=>[view.scrollLeft,view.scrollTop]), immediate);
        assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)), original);
        if (!touch) {
          const savedView = await page.locator('.tree').evaluate(view=>({left:view.scrollLeft,top:view.scrollTop}));
          await page.waitForFunction(position=>{
            const state=JSON.parse(sessionStorage.getItem('family-tree:canvas-view:v1:'+location.pathname)||'null');
            return state && Math.abs(state.scrollLeft-position.left)<2 && Math.abs(state.scrollTop-position.top)<2;
          }, savedView);
          await page.reload();
          await page.waitForFunction(()=>FamilyApp?.graph?.() && document.querySelector('.person'));
          await settle();
          const restored = await page.locator('.tree').evaluate(view=>({left:view.scrollLeft,top:view.scrollTop}));
          assert(Math.abs(restored.left-savedView.left)<2 && Math.abs(restored.top-savedView.top)<2,
            JSON.stringify({reason:'Reload restores the same view',savedView,restored}));
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}x${height} ${reducedMotion}: legend, real line fades, member/relative/locate camera, cancellation, unchanged data`);
        await context.close();
      }
    }
  } finally {
    await browser?.close(); await new Promise(resolve=>server.close(resolve));
    if (path.dirname(dir)!==path.resolve(os.tmpdir())) throw new Error('Unexpected test directory');
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });
