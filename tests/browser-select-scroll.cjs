const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium';
assert(['chromium', 'webkit'].includes(browserName), 'Select Chromium or WebKit for this suite');

async function swipe(page, session, list, direction) {
  const box = await list.boundingBox();
  assert(box && box.height > 40, 'The option list must have room for a touch gesture');
  const x = box.x + box.width / 2;
  const from = box.y + (direction === 'up' ? box.height - 10 : 10);
  const to = box.y + (direction === 'up' ? 10 : box.height - 10);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * step / 10 }]
    });
    await page.waitForTimeout(20);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
}

async function scrollOptions(page, session, list, direction, mobileWebKit) {
  if (session) return swipe(page, session, list, direction);
  // Playwright exposes native touch swipes through Chromium's CDP only.
  // Mobile WebKit also rejects wheel input: verify its scroll range/layout
  // programmatically and use native touch taps for selection. Desktop WebKit
  // still exercises wheel scrolling. Neither reproduces iOS native swipes.
  const delta = direction === 'up' ? 160 : -160;
  if (mobileWebKit) await list.evaluate((node, value) => node.scrollBy(0, value), delta);
  else { await list.hover(); await page.mouse.wheel(0, delta); }
  await page.waitForTimeout(300);
}

async function metrics(panel) {
  return panel.evaluate(element => {
    const list = element.querySelector('.select-options');
    const selected = list.querySelector('[aria-selected="true"]');
    const rect = list.getBoundingClientRect(), item = selected?.getBoundingClientRect();
    return {
      top: list.scrollTop, max: list.scrollHeight - list.clientHeight,
      selectedVisible: !!item && item.top >= rect.top - 1 && item.bottom <= rect.bottom + 1,
      panel: element.getBoundingClientRect().toJSON(),
      searchTop: element.querySelector('.select-search').getBoundingClientRect().top,
      outerScrolls: [...document.querySelectorAll('.form-scroll,.relationship-search')].map(node => node.scrollTop),
      pageTop: document.scrollingElement.scrollTop
    };
  });
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-select-scroll-'));
  const dataFile = path.join(dir, 'family.json');
  await fs.copyFile(path.join(__dirname, '../fixtures/family.json'), dataFile);
  const server = createFamilyServer({ dataFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright[browserName].launch({
      headless: true,
      ...(browserName === 'chromium' ? { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' } : {})
    });
    for (const [width, height, touch] of [[390, 844, true], [360, 640, true], [844, 390, true], [1440, 900, false]]) {
      const mobileWebKit = touch && browserName === 'webkit';
      const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.FamilyApp?.graph() && document.getElementById('mobile-search-open'));
        await page.locator('#mobile-search-open').click();
        const select = page.locator('#relationship-a');
        await select.evaluate(node => { node.selectedIndex = node.options.length - 1; });
        await page.locator('#relationship-a + .select-trigger').click();
        const panel = page.locator('.select-dropdown:popover-open');
        const list = panel.locator('.select-options');
        await panel.evaluate(async node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
        assert((await metrics(panel)).selectedVisible, 'Opening a long list must reveal the selected option');

        await list.evaluate(node => { node.scrollTop = 0; });
        await page.waitForTimeout(50);
        const before = await metrics(panel), value = await select.inputValue();
        assert(before.max > 100, 'The fixture must overflow the option list');
        const session = touch && browserName === 'chromium' ? await context.newCDPSession(page) : null;
        await scrollOptions(page, session, list, 'up', mobileWebKit);
        const after = await metrics(panel);
        assert(after.top > 20, 'The option list must have a usable scroll range');
        assert.deepEqual(after.outerScrolls, before.outerScrolls, 'The underlying dialog must stay still');
        assert.equal(after.pageTop, before.pageTop);
        assert.deepEqual(after.panel, before.panel, 'The popup must stay anchored while scrolling');
        assert.equal(after.searchTop, before.searchTop, 'Search must stay visible while scrolling');
        assert.equal(await select.inputValue(), value, 'Swiping must not select an option');

        await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await scrollOptions(page, session, list, 'down', mobileWebKit);
        assert((await metrics(panel)).top < before.max - 20, 'The list must also scroll back up');
        await panel.locator('.select-search').fill('不存在的搜尋結果');
        assert.equal(await list.locator('[role="option"]').count(), 0);
        await panel.locator('.select-search').fill('');
        assert((await metrics(panel)).selectedVisible, 'Clearing search must reveal the selected option again');
        await panel.locator('.select-search').press('ArrowUp');
        await panel.locator('.select-search').press('Enter');
        await panel.waitFor({ state: 'hidden' });
        assert.notEqual(await select.inputValue(), value);

        await page.locator('#relationship-sheet-close').click();
        await page.locator('#add-member').click();
        await page.locator('#add-relation').click();
        await page.locator('.relation-type + .select-trigger').click();
        await panel.evaluate(async node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
        await list.evaluate(node => { node.scrollTop = 0; });
        if (touch && width > height) {
          const keyboard = await page.evaluate(() => {
            const scroller = document.querySelector('#member-form .form-scroll');
            const before = scroller.scrollTop;
            const viewport = window.visualViewport;
            const descriptor = Object.getOwnPropertyDescriptor(viewport, 'height');
            // Safari can report the smaller viewport before the popup has moved.
            Object.defineProperty(viewport, 'height', { configurable: true, value: 100 });
            try {
              FamilyMobileGesturePolicy.ensureFocusedControlVisible();
              return { before, after: scroller.scrollTop };
            } finally {
              if (descriptor) Object.defineProperty(viewport, 'height', descriptor);
              else delete viewport.height;
            }
          });
          assert.equal(keyboard.after, keyboard.before, 'Popup focus must not scroll its underlying form when the keyboard opens');
        }
        await scrollOptions(page, session, list, 'up', mobileWebKit);
        assert((await metrics(panel)).top > 20, 'The member form must allow option scrolling too');
        const optionId = await list.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return [...node.children].find(option => {
            const item = option.getBoundingClientRect();
            return item.top >= rect.top && item.bottom <= rect.bottom;
          })?.id;
        });
        assert(optionId, 'At least one scrolled option must be tappable');
        const option = page.locator('#' + optionId);
        if (touch) await option.tap();
        else await option.click();
        await panel.waitFor({ state: 'hidden' });
        assert(await page.locator('.relation-type').inputValue(), 'Tapping a scrolled option must update the form');
        await page.locator('#member-gender + .select-trigger').click();
        assert(await panel.locator('.select-search').isHidden(), 'Small fixed lists do not need search');
        assert.equal(await list.locator('[role="option"]').count(), 3);
        await list.press('Escape');
        assert.deepEqual(errors, []);
        const input = session ? 'native touch swipe/tap' : touch ? 'layout/programmatic scroll/touch tap (no native iOS swipe)' : 'mouse';
        console.log(`select scrolling PASS ${browserName} ${width}x${height} ${input}`);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
