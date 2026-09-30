const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');

// Exercise real native dialogs/popovers and their interrupted exits, rather
// than testing CSS strings. No application fixture is modified by this suite.
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-motion-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.copyFile(path.join(__dirname, '../fixtures/family.json'), dataFile);
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    for (const [width, height, touch, reducedMotion] of [
      [1440, 900, false, 'no-preference'],
      [390, 844, true, 'no-preference'],
      [844, 390, true, 'no-preference'],
      [390, 844, true, 'reduce'],
      [844, 390, true, 'reduce'],
      [1440, 900, false, 'reduce']
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, reducedMotion });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.stack || error.message));
      // Exercise config-before-family startup ordering explicitly.
      await page.route('**/api/family', async route => {
        await new Promise(resolve => setTimeout(resolve, 150));
        await route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.FamilyEditor?.snapshot() && document.querySelector('.person'));
      await page.waitForFunction(() => !document.getElementById('kinship-status').textContent);
      const original = await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data));
      await page.evaluate(() => {
        window.motionEvents = [];
        document.addEventListener('transitionrun', event => {
          if (event.propertyName === 'opacity' || event.propertyName === 'transform') {
            window.motionEvents.push({ id: event.target.id, cls: event.target.className, property: event.propertyName, pseudo: event.pseudoElement });
          }
        });
      });
      const motion = selector => page.locator(selector).first().evaluate(element => {
        const style = getComputedStyle(element);
        return { duration: style.transitionDuration, properties: style.transitionProperty,
          opacity: style.opacity, transform: style.transform, open: element.open, hidden: element.hidden,
          display: style.display, inert: element.inert,
          animations: element.getAnimations().map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration })) };
      });
      const settle = () => page.waitForTimeout(340);
      const clear = () => page.evaluate(() => { window.motionEvents.length = 0; });
      const didAnimate = id => page.evaluate(id => window.motionEvents.some(event => event.id === id && event.property === 'opacity'), id);
      const duration = (state, ms) => assert(state.duration.split(',').every(value => Number.parseFloat(value) === ms / 1000), JSON.stringify(state));
      const activate = async selector => {
        if (touch) await page.locator(selector).first().tap();
        else await page.locator(selector).first().click();
      };

      // Keyboard opening and Escape close are immediate, including focus.
      await page.locator('#add-member').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'member-name');
      assert.equal((await motion('#member-dialog')).duration, '0s');
      assert.equal((await motion('#member-dialog')).animations.length, 0);
      await page.keyboard.press('Escape');
      assert.equal((await motion('#member-dialog')).display, 'none');

      await clear();
      await activate('#add-member');
      duration(await motion('#member-dialog'), reducedMotion === 'reduce' ? 80 : 240);
      await settle();
      assert(await didAnimate('member-dialog'), 'Pointer dialog entrance should transition');
      assert.equal((await motion('#member-dialog')).opacity, '1');
      if (reducedMotion === 'reduce') {
        assert.equal((await motion('#member-dialog')).transform, 'none');
        assert(!await page.evaluate(() => window.motionEvents.some(event => event.id === 'member-dialog' && event.property === 'transform')));
      }
      // New/undone rows animate once; loading an existing row does not.
      await clear();
      const rowCount = await page.locator('.relation-row').count();
      await activate('#add-relation');
      assert.equal(await page.locator('.relation-row').count(), rowCount + 1);
      await settle();
      assert(await page.evaluate(() => window.motionEvents.some(event => String(event.cls).includes('motion-relation-reveal'))));
      assert.equal(await page.locator('.motion-relation-reveal').count(), 0, 'Reveal classes are cleaned after actual completion');
      await activate('.relation-row:last-child .remove-relation');
      await clear();
      await activate('.relation-removal-status button');
      await settle();
      assert.equal(await page.locator('.relation-row').count(), rowCount + 1);
      assert(await page.evaluate(() => window.motionEvents.some(event => String(event.cls).includes('motion-relation-reveal'))));
      await activate('.relation-row:last-child .remove-relation');
      assert.equal(await page.locator('.relation-row').count(), rowCount, 'Restore the form baseline before testing close');
      await settle(); // Let the draft debounce remove the now-clean draft.
      await activate('#cancel-member');
      assert.equal((await motion('#member-dialog')).open, false, 'Logical close must not wait for paint');
      // Reopen while the old surface/backdrop is still exiting. It must not
      // intercept the toolbar, strand focus or finish closing the new dialog.
      await activate('#add-member');
      await settle();
      assert.equal((await motion('#member-dialog')).open, true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'member-name');
      await page.keyboard.press('Escape');

      await clear();
      await activate('.person[data-person-id="p11"]');
      const panel = '#relationship-details';
      duration(await motion(panel), reducedMotion === 'reduce' ? 80 : touch ? 120 : 160);
      await settle();
      assert(await didAnimate('relationship-details'));
      assert.equal((await motion(panel)).opacity, '1');
      duration(await motion('.tree__canvas svg [data-people]'), reducedMotion === 'reduce' ? 80 : 180);
      if (await page.locator(panel).getAttribute('data-collapsed') === 'true') {
        await activate('.relationship-details__tab');
        await settle();
      }
      await clear();
      await activate('.details-collapse');
      await settle();
      assert(await page.evaluate(() => window.motionEvents.some(event => String(event.cls).includes('motion-details-reveal'))), 'Collapse should reveal the compact summary');
      await activate('.relationship-details__tab');
      await settle();
      // Inspecting a relative changes data immediately without replaying entry.
      await clear();
      await activate('.relationship-entry__person');
      await settle();
      assert(!await didAnimate('relationship-details'), 'Member browsing must not replay panel entry');
      assert(!await page.evaluate(() => window.motionEvents.some(event => String(event.cls).includes('motion-details-reveal'))));
      await activate('.details-close');
      assert.equal((await motion(panel)).hidden, true);
      assert.equal((await motion(panel)).inert, true);
      await settle();

      // Exercise cloud surfaces without authenticating or contacting Drive.
      await page.evaluate(() => {
        document.documentElement.dataset.motionInput = 'pointer';
        for (const id of ['cloud-sync-alert', 'cloud-auth-toast']) {
          document.getElementById(id).hidden = false;
        }
      });
      await settle();
      for (const id of ['cloud-sync-alert', 'cloud-auth-toast']) {
        assert(await didAnimate(id), `${id} must have a real entrance`);
        duration(await motion(`#${id}`), reducedMotion === 'reduce' ? 80 : 180);
      }
      await clear();
      await page.evaluate(() => { document.getElementById('cloud-auth-toast').dataset.authState = 'success'; });
      await settle();
      assert(!await didAnimate('cloud-auth-toast'), 'Cloud state updates should not replay entry');
      await page.evaluate(() => {
        for (const id of ['cloud-sync-alert', 'cloud-auth-toast']) document.getElementById(id).hidden = true;
        document.documentElement.dataset.motionInput = 'keyboard';
        document.getElementById('cloud-auth-toast').hidden = false;
      });
      assert.equal((await motion('#cloud-auth-toast')).duration, '0s');
      await page.evaluate(() => { document.getElementById('cloud-auth-toast').hidden = true; });
      const smoothPolicy = await page.evaluate(() => {
        document.documentElement.dataset.motionInput = 'pointer';
        const pointer = FamilyMotion.shouldScrollSmooth();
        const button = document.querySelector('.cloud-sync-button');
        const state = button.dataset.syncState;
        button.dataset.syncState = 'syncing';
        const pulse = getComputedStyle(button, '::after').animationName;
        if (state === undefined) delete button.dataset.syncState; else button.dataset.syncState = state;
        document.documentElement.dataset.motionInput = 'keyboard';
        return { pointer, keyboard: FamilyMotion.shouldScrollSmooth(), pulse };
      });
      assert.equal(smoothPolicy.pointer, reducedMotion !== 'reduce');
      assert.equal(smoothPolicy.keyboard, false);
      if (reducedMotion === 'reduce') assert.equal(smoothPolicy.pulse, 'none');
      if (!touch && reducedMotion !== 'reduce') {
        // A longer CSS transition must not be cut off by the old 180ms timer.
        await page.evaluate(() => {
          document.documentElement.dataset.motionInput = 'pointer';
          const element = document.createElement('div');
          element.id = 'long-reveal-check';
          element.style.cssText = 'position:fixed;left:-1000px;width:10px;height:10px;transition-duration:260ms';
          document.body.append(element);
          FamilyMotion.reveal(element);
        });
        await page.waitForTimeout(200);
        assert(await page.locator('#long-reveal-check').evaluate(element => element.classList.contains('motion-details-reveal')));
        await page.waitForFunction(() => !document.getElementById('long-reveal-check').classList.contains('motion-details-reveal'));
        await page.locator('#long-reveal-check').evaluate(element => element.remove());
      }

      // Pointer select entry is subtle; typing/arrow navigation switches to
      // immediate motion and keeps the searchable input focused.
      await activate('#add-member');
      await page.keyboard.press('Escape');
      await activate('#add-member');
      await settle();
      const trigger = '#member-form .select-trigger';
      await activate(trigger);
      await settle();
      duration(await motion('.select-dropdown:popover-open'), reducedMotion === 'reduce' ? 80 : 150);
      assert.equal((await motion('.select-dropdown:popover-open')).opacity, '1');
      await page.keyboard.press('Escape');
      await page.locator(trigger).first().focus();
      await page.keyboard.press('ArrowDown');
      assert.equal((await motion('.select-dropdown:popover-open')).duration, '0s');
      assert.equal((await motion('.select-dropdown:popover-open')).animations.length, 0);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      if (touch) {
        if (height < width) {
          await activate('#landscape-more-open');
          await activate('[data-action="relationship"]');
        } else await activate('#mobile-search-open');
        await settle();
        await page.evaluate(() => {
          for (const [id, value] of [['relationship-a', 'p11'], ['relationship-b', 'p12']]) {
            const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        await activate('#relationship-search [type=submit]');
        await page.locator('.relationship-result-details').waitFor();
        await settle();
        assert(await didAnimate('relationship-summary'), 'First query summary should enter');
        duration(await motion('#relationship-summary'), reducedMotion === 'reduce' ? 80 : 180);
        await clear();
        await activate('.relationship-result-details');
        duration(await motion('#relationship-result-sheet'), reducedMotion === 'reduce' ? 80 : 280);
        await settle();
        assert(await didAnimate('relationship-result-sheet'));
        assert.equal((await motion('#relationship-result-sheet')).opacity, '1');
        await activate('#relationship-result-sheet-close');
        assert.equal((await motion('#relationship-result-sheet')).open, false);
        await settle();
        await activate('.relationship-result-end');
        await settle();
      }
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)), original, 'Motion must not alter family data');

      // A real save yields the toast; rapid undo replaces text in place rather
      // than replaying a second entrance or retaining stale timer state.
      if (touch) {
        await activate(height < width ? '#landscape-more-open' : '#portrait-more-open');
        await activate('[data-action="family-name"]');
      } else await activate('#edit-family-name');
      await page.locator('#family-name-input').fill(`動畫測試 ${width} ${reducedMotion}`);
      await clear();
      await activate('#save-family-name');
      await page.waitForFunction(() => document.getElementById('save-status').dataset.kind === 'success');
      await settle();
      assert(await didAnimate('save-status'));
      assert.equal((await motion('#save-status')).opacity, '1');
      duration(await motion('#save-status'), reducedMotion === 'reduce' ? 80 : 200);
      await clear();
      await activate('.save-status__action');
      await page.waitForFunction(() => document.getElementById('save-status').dataset.kind === 'info');
      await settle();
      assert(!await didAnimate('save-status'), 'Replacing visible feedback must not replay its entrance');
      assert.equal(await page.evaluate(() => JSON.stringify(FamilyApp.snapshot().data)), original);
      await page.locator('#save-status').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}x${height} ${reducedMotion}: native exits, reopening, focus, inspector, select, sheet, toast/undo, unchanged data`);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    // mkdtemp returns an absolute, isolated test directory under os.tmpdir().
    if (path.dirname(dir) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test directory');
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
