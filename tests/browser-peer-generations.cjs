// Run with node tests/browser-peer-generations.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const child = personId => ({ type: 'child', personId, kind: '親生' });
const initial = { schemaVersion: 2, people: [person('G'), person('P', [parent('G')]), person('C', [parent('P')]),
  person('A', [{ type: 'fellowDisciple', personId: 'C' }]), person('B', [parent('A')]), person('X'), person('Y', [parent('X')])] };
const sourceData = data => ({ ...data, people: data.people.map(({ inferredRelationships, ...person }) => person) });

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-peer-generations-'));
  const dataFile = path.join(dir, 'family.json');
  const server = createFamilyServer({ dataFile });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }) });
    for (const mode of ['api', 'static']) for (const width of [1280, 390]) {
      await fs.writeFile(dataFile, JSON.stringify(initial));
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      context.setDefaultTimeout(10_000);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({ browserStorage: true });
        await page.route(base + '/', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.addInitScript(data => localStorage.setItem('family-static-v1:/', JSON.stringify({ data, version: 'initial' })), { ...initial, schemaVersion: 3 });
      }
      async function checkGenerations(expected) {
        await page.waitForFunction(expected => Object.entries(expected).every(([id, gen]) =>
          Number(document.querySelector(`.person[data-person-id="${id}"]`)?.closest('.generation')?.dataset.gen) === gen), expected).catch(async error => {
          console.error({mode,width,expected,actual:await page.locator('.person').evaluateAll(nodes => Object.fromEntries(nodes.map(node =>
            [node.dataset.personId,Number(node.closest('.generation').dataset.gen)]))),errors});
          throw error;
        });
        const actual = await page.locator('.person').evaluateAll(nodes => Object.fromEntries(nodes.map(node =>
          [node.dataset.personId, Number(node.closest('.generation').dataset.gen)])));
        for (const [id, gen] of Object.entries(expected)) assert.equal(actual[id], gen, `${mode}, ${width}: ${id}`);
      }
      await page.goto(base);
      await checkGenerations({ G: 1, P: 2, C: 3, A: 3, B: 4, X: 1, Y: 2 });
      assert.deepEqual(sourceData(await page.evaluate(() => FamilyApp.snapshot().data)), { ...initial, schemaVersion: 3 });
      const peerRows = await page.locator('.person[data-person-id="A"],.person[data-person-id="C"]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert(Math.abs(peerRows[0] - peerRows[1]) < 1, 'fellow disciples share the rendered row');
      if (process.env.PEER_GENERATION_SCREENSHOTS) await page.locator('#tree-canvas').screenshot({ path: path.join(process.env.PEER_GENERATION_SCREENSHOTS, `peer-generations-${mode}-${width}.png`) });
      await page.reload();
      await checkGenerations({ C: 3, A: 3, B: 4 });

      // A newly recorded father makes A's own ancestry authoritative.
      const fatherId = await page.evaluate(async member => {
        const result = await FamilyApp.addMember({ member, requestId: crypto.randomUUID(), version: FamilyApp.snapshot().version });
        return result.data.people.find(person => person.name === 'D').id;
      }, person('D', [child('A')]));
      await checkGenerations({ [fatherId]: 1, A: 2, B: 3, C: 3, X: 1, Y: 2 });
      await page.reload();
      await checkGenerations({ [fatherId]: 1, A: 2, B: 3, C: 3 });
      await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
      await checkGenerations({ C: 3, A: 3, B: 4 });
      assert.deepEqual(sourceData(await page.evaluate(() => FamilyApp.snapshot().data)), { ...initial, schemaVersion: 3 });

      // Until A has ancestors, it keeps following C when C's ancestry expands.
      await page.evaluate(member => FamilyApp.addMember({ member, requestId: crypto.randomUUID(), version: FamilyApp.snapshot().version }), person('E', [child('G')]));
      await checkGenerations({ G: 2, P: 3, C: 4, A: 4, B: 5, X: 1, Y: 2 });
      await page.reload();
      await checkGenerations({ C: 4, A: 4, B: 5 });
      assert.deepEqual(await page.evaluate(() => FamilyModel.relationshipsFor(FamilyApp.snapshot().data, 'A').filter(relation => ['parent', 'grandparent'].includes(relation.type))), []);

      // School-only students follow their teacher by one generation; peers stay together.
      const school = {schemaVersion:3,people:[person('T'),person('A',[{type:'teacher',personId:'T'}]),
        person('B',[{type:'teacher',personId:'T'}]),person('C',[{type:'fellowDisciple',personId:'B'}]),
        person('D',[{type:'teacher',personId:'A'}]),person('X'),person('Y',[parent('X')])]};
      await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),school);
      await checkGenerations({ T:1,A:2,B:2,C:2,D:3,X:1,Y:2 });
      // A teacher with recorded ancestors must still put otherwise unplaced students below it.
      const anchoredSchool = {...school,people:[person('G'),...school.people.map(p => p.id === 'T' ? {...p,relationships:[parent('G')]} : p)]};
      await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),anchoredSchool);
      await checkGenerations({ G:1,T:2,A:3,B:3,C:3,D:4,X:1,Y:2 });
      const schoolSnapshot = await page.evaluate(() => FamilyApp.snapshot());
      assert.deepEqual(sourceData(schoolSnapshot.data),anchoredSchool);
      const studentRows = await page.locator('.person[data-person-id="A"],.person[data-person-id="B"],.person[data-person-id="C"]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
      assert(studentRows.every(top => Math.abs(top-studentRows[0]) < 1),'students and fellow disciples share the actual rendered row');
      await page.reload();
      await checkGenerations({ G:1,T:2,A:3,B:3,C:3,D:4 });
      const reloaded = await page.evaluate(() => FamilyApp.snapshot());
      assert.deepEqual(reloaded.data,schoolSnapshot.data,'projection and reload do not alter saved relationships');
      assert.equal(reloaded.version,schoolSnapshot.version,'projection and reload do not create a new data version');

      // Adding A's own family relationship overrides the school placement for its branch.
      await page.evaluate(() => {
        const snapshot = FamilyApp.snapshot(), member = snapshot.data.people.find(p => p.id === 'A');
        return FamilyApp.updateMember('A',{version:snapshot.version,member:{...member,relationships:[...FamilyModel.relationshipsFor(snapshot.data,'A'),{type:'parent',personId:'G',kind:'親生'}]}});
      });
      await checkGenerations({ G:1,T:2,A:2,B:3,C:3,D:3,X:1,Y:2 });
      await page.reload();
      await checkGenerations({ G:1,T:2,A:2,B:3,C:3,D:3 });
      await page.evaluate(() => FamilyApp.undo(FamilyApp.snapshot().version));
      await checkGenerations({ G:1,T:2,A:3,B:3,C:3,D:4 });
      assert.deepEqual(sourceData(await page.evaluate(() => FamilyApp.snapshot().data)),anchoredSchool);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS: school-only and anchored-teacher generations, same-generation peers, family priority, descendant placement, new ancestors, undo and reload in API/static desktop/mobile');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
