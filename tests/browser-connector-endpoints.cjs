// Run with node tests/browser-connector-endpoints.cjs (requires Playwright).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');
const p = (id,relationships=[],extra={}) => ({id,name:id,gender:'M',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent = personId => ({type:'parent',personId,kind:'親生'});
const teacher = personId => ({type:'teacher',personId});
const fellow = personId => ({type:'fellowDisciple',personId});
const fixtures = [
  {id:'mixed-down',people:[p('G'),p('T',[parent('G')]),p('A',[parent('T'),teacher('T')]),p('B',[teacher('T')]),p('C',[parent('T')]),p('F',[fellow('B')])]},
  {id:'adjacent-peers',people:[p('A',[fellow('B')]),p('B',[],{position:'長職位說明'.repeat(9)})]},
  {id:'blocked-peers',people:[p('A',[fellow('C')]),p('B',[fellow('A')]),p('C')]},
  {id:'teacher-up',people:[p('A',[teacher('T')]),p('T',[parent('A')])]},
  {id:'teacher-same-generation',people:[p('A',[teacher('T'),{type:'spouse',personId:'T'}]),p('T')]},
  {id:'intermediate-grandparent',people:[p('G'),p('C',[{type:'grandparent',personId:'G',kind:'親生'}])]}
];

// Inspect visible geometry rather than implementation-selected port metadata.
async function geometry(page) {
  return page.evaluate(() => {
    const origin = document.getElementById('tree-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.person')].map(node => {
      const b = node.getBoundingClientRect();
      return {id:node.dataset.personId,gen:Number(node.closest('.generation').dataset.gen),left:b.left-origin.left,right:b.right-origin.left,top:b.top-origin.top,bottom:b.bottom-origin.top};
    });
    const contacts = [],collisions = [],badDirections = [];
    for (const line of document.querySelectorAll('#tree-connectors path[data-points]')) {
      const points = line.dataset.points.split(' ').map(pair => pair.split(',').map(Number));
      const people = line.dataset.people.split(' ');
      for (let i = 1; i < points.length; i++) for (const card of cards) {
        const [a,b] = [points[i-1],points[i]];
        const crosses = a[0] === b[0]
          ? a[0] > card.left + .5 && a[0] < card.right - .5 && Math.max(a[1],b[1]) > card.top + .5 && Math.min(a[1],b[1]) < card.bottom - .5
          : a[1] > card.top + .5 && a[1] < card.bottom - .5 && Math.max(a[0],b[0]) > card.left + .5 && Math.min(a[0],b[0]) < card.right - .5;
        if (crosses) collisions.push({card:card.id,kind:line.dataset.kind,a,b});
      }
      for (const [point,neighbor] of [[points[0],points[1]],[points.at(-1),points.at(-2)]]) {
        if (!neighbor) continue;
        for (const card of cards) {
          let side;
          if (point[0] > card.left+1 && point[0] < card.right-1) {
            if (Math.abs(point[1]-card.top) < .1) side = 'top';
            else if (Math.abs(point[1]-card.bottom) < .1) side = 'bottom';
          }
          if (point[1] > card.top+1 && point[1] < card.bottom-1) {
            if (Math.abs(point[0]-card.left) < .1) side = 'left';
            else if (Math.abs(point[0]-card.right) < .1) side = 'right';
          }
          if (!side) continue;
          const normal = {top:[0,-1],bottom:[0,1],left:[-1,0],right:[1,0]}[side];
          const delta = neighbor.map((value,i) => value-point[i]);
          if (delta[0]*normal[0]+delta[1]*normal[1] <= 0 || delta[0]*normal[1]-delta[1]*normal[0] !== 0) badDirections.push({id:card.id,side,point,neighbor});
          contacts.push({id:card.id,side,point,kind:line.dataset.kind,group:line.dataset.group,people,gen:card.gen});
        }
      }
    }
    return {cards,contacts,collisions,badDirections};
  });
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'family-endpoints-'));
  const dataFile = path.join(dir,'family.json'),server = createFamilyServer({dataFile});
  let browser;
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE} : {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'})});
    for (const mode of ['api','static']) for (const width of [1280,390,844]) {
      const context = await browser.newContext({viewport:{width,height:width === 844 ? 390 : 900},reducedMotion:'reduce'});
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({browserStorage:true});
        await context.route(base+'/',route => route.fulfill({contentType:'text/html',body:html}));
      }
      const page = await context.newPage(),errors = [];
      page.on('pageerror',error => errors.push(error.message));
      await fs.writeFile(dataFile,JSON.stringify({schemaVersion:3,people:fixtures[0].people}));
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data);
      for (const fixture of fixtures) {
        const data = {schemaVersion:3,people:fixture.people};
        await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),data);
        await page.waitForFunction(count => document.querySelectorAll('.person').length === count,fixture.people.length);
        const snapshot = await page.evaluate(() => FamilyApp.snapshot());
        const result = await geometry(page), message = `${fixture.id}: ${mode} ${width}`;
        assert.deepEqual(result.collisions,[],message+' avoids cards');
        assert.deepEqual(result.badDirections,[],message+' approaches card edges perpendicularly');
        const find = (id,kind) => result.contacts.filter(contact => contact.id === id && contact.kind === kind);
        if (fixture.id === 'mixed-down') {
          assert(find('T','師徒').every(contact => contact.side === 'bottom'),message+' teacher exits below');
          assert(find('T','師徒').length && find('A','師徒').length && find('B','師徒').length,message+' all school endpoints exist');
          for (const id of ['A','B']) assert(find(id,'師徒').every(contact => contact.side === 'top'),message+' student receives above');
          const ports = result.contacts.filter(contact => contact.id === 'T' && contact.side === 'bottom');
          assert.equal(new Set(ports.map(contact => contact.group)).size,2,message+' family and school ports both exist');
          for (const a of ports) for (const b of ports) if (a.group !== b.group) assert(Math.abs(a.point[0]-b.point[0]) >= 17.9,message+' unrelated outgoing ports stay separated');
        }
        if (fixture.id === 'adjacent-peers') {
          assert(find('A','師兄弟姊妹').length && find('B','師兄弟姊妹').length,message+' peer endpoints exist');
          assert(find('A','師兄弟姊妹').every(contact => contact.side === 'right'),message+' left peer faces right');
          assert(find('B','師兄弟姊妹').every(contact => contact.side === 'left'),message+' right peer faces left');
        }
        if (fixture.id === 'blocked-peers') assert(result.contacts.filter(contact => contact.kind === '師兄弟姊妹' && contact.people.includes('A') && contact.people.includes('C')).every(contact => contact.side === 'top'),message+' blocked peers use the upper gutter');
        if (fixture.id === 'teacher-up') {
          assert(find('T','師徒').every(contact => contact.side === 'top'),message+' a lower teacher exits upwards');
          assert(find('A','師徒').every(contact => contact.side === 'bottom'),message+' an upper student receives below');
        }
        if (fixture.id === 'teacher-same-generation') assert(result.contacts.filter(contact => contact.kind === '師徒').every(contact => ['left','right'].includes(contact.side)),message+' family placement determines school endpoint sides');
        if (fixture.id === 'intermediate-grandparent') {
          assert(result.contacts.filter(contact => contact.id === 'G' && contact.kind === '親生').every(contact => contact.side === 'bottom'),message+' virtual ancestor route starts below');
          assert(result.contacts.filter(contact => contact.id === 'C' && contact.kind === '親生').every(contact => contact.side === 'top'),message+' virtual ancestor route arrives above');
        }
        if (process.env.ENDPOINT_SCREENSHOTS && mode === 'api' && width === 1280) {
          await fs.mkdir(process.env.ENDPOINT_SCREENSHOTS,{recursive:true});
          await page.locator('#tree-canvas').screenshot({path:path.join(process.env.ENDPOINT_SCREENSHOTS,fixture.id+'.png')});
        }
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot()),snapshot,message+' geometry does not mutate family data');
      }
      assert.deepEqual(errors,[]);
      console.log(`PASS: connector endpoints ${mode} ${width}`);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
