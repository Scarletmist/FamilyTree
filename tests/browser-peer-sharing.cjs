// Run with node tests/browser-peer-sharing.cjs; set PLAYWRIGHT_BROWSER=webkit for WebKit.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const Model = require('../src/assets/family-model.js');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');

const person = (id,relationships=[],extra={}) => ({id,name:id,gender:'M',location:'',position:'',siblingOrder:null,relationships,...extra});
const cousin = (personId,type='tangCousin',seniority) => ({type,personId,...(seniority ? {seniority} : {})});
const sibling = personId => ({type:'sibling',personId});
const parent = personId => ({type:'parent',personId,kind:'親生'});
function cousins({type='tangCousin',order=['A','C','B'],inferred=false,related=true,tall=false,parents=false}={}) {
  const people = [
    person('A',[...(related ? [sibling('B')] : []),cousin('C',type,'younger'),...(parents ? [parent('P')] : [])]),
    person('B',[...(!inferred ? [cousin('C',type,'older')] : []),...(parents ? [parent('P')] : [])],tall ? {position:'需要換行的成員職位說明'.repeat(7)} : {}),
    person('C',[],{position:'中間成員'})
  ];
  return {schemaVersion:3,people:[...order.map(id => people.find(p => p.id === id)),...(parents ? [person('P')] : [])]};
}
const ignorePlans = data => ({...data,ignoredIntermediatePlans:Model.intermediatePlans(data).map(p => p.id)});
const fixtures = [
  {id:'tang-pending-parents',data:cousins(),kind:'堂親',root:'C',members:['A','B','C'],groups:1,pending:true},
  ...[['A','C','B'],['C','A','B'],['A','B','C']].map((order,i) => ({id:'tang-position-'+i,data:ignorePlans(cousins({order})),kind:'堂親',root:'C',members:['A','B','C'],groups:1})),
  {id:'tang-different-heights',data:ignorePlans(cousins({tall:true})),kind:'堂親',root:'C',members:['A','B','C'],groups:1},
  {id:'tang-manual-inferred',data:ignorePlans(cousins({inferred:true})),kind:'堂親',root:'C',members:['A','B','C'],groups:1,inferred:true},
  {id:'biao-sibling-cohort',data:ignorePlans(cousins({type:'biaoCousin'})),kind:'表親',root:'C',groups:2},
  {id:'biao-common-parent',data:ignorePlans(cousins({type:'biaoCousin',parents:true})),kind:'表親',root:'C',groups:2},
  {id:'tang-unknown-cohort',data:ignorePlans(cousins({related:false})),kind:'堂親',root:'C',groups:2},
  {id:'school-peer-fork',data:{schemaVersion:3,people:[
    person('A',[{type:'spouse',personId:'T'},{type:'fellowDisciple',personId:'B'},{type:'teacher',personId:'T'}]),
    person('T'),person('B',[{type:'teacher',personId:'T'},{type:'spouse',personId:'T'}])
  ]},kind:'師徒',root:'T',members:['A','B','T'],groups:1},
  {id:'siblings-common-parent',data:{schemaVersion:3,people:[
    person('A',[parent('P'),sibling('B'),sibling('C')]),person('B',[parent('P'),sibling('C')]),person('C',[parent('P')]),person('P')
  ]},kind:'手足',root:'A',members:['A','B','C'],groups:2},
  {id:'school-rank-details',data:{schemaVersion:3,people:[
    ...['A','B','C'].map(id => person(id,[{type:'teacher',personId:'T'}])),person('T')
  ],rankGroups:[{id:'school',name:'師門排行',type:'fellowDisciple',members:['A','B','C'].map((personId,i) => ({personId,order:i+1}))}]},kind:'師兄弟姊妹',root:'A',members:['A','B','C'],groups:2,details:true},
  {id:'school-opposite-generations',data:{schemaVersion:3,people:[
    person('A'),person('T',[parent('A'),{type:'student',personId:'A'},{type:'student',personId:'B'}]),person('B')
  ]},kind:'師徒',root:'T',groups:1,opposite:true}
];

async function geometry(page) {
  return page.evaluate(() => {
    const origin = document.getElementById('tree-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.person')].map(node => {
      const b = node.getBoundingClientRect();
      return {id:node.dataset.personId,gen:Number(node.closest('.generation').dataset.gen),left:b.left-origin.left,right:b.right-origin.left,top:b.top-origin.top,bottom:b.bottom-origin.top};
    });
    const paths = [...document.querySelectorAll('#tree-connectors path[data-points]')].map(node => ({
      points:node.dataset.points.split(' ').map(p => p.split(',').map(Number)),people:node.dataset.people.split(' '),
      kind:node.dataset.kind,group:node.dataset.group,inferred:node.dataset.inferred === 'true',detailsOnly:node.dataset.detailsOnly === 'true',display:node.style.display,opacity:node.style.opacity
    }));
    const contacts = [],collisions = [],badDirections = [];
    for (const line of paths) {
      const segments = FamilyConnectorRouting.segments(line.points);
      for (const s of segments) for (const card of cards) {
        const hit = s.axis === 'v'
          ? s.fixed > card.left+.5 && s.fixed < card.right-.5 && s.max > card.top+.5 && s.min < card.bottom-.5
          : s.fixed > card.top+.5 && s.fixed < card.bottom-.5 && s.max > card.left+.5 && s.min < card.right-.5;
        if (hit) collisions.push({id:card.id,kind:line.kind,s});
      }
      for (const [point,neighbor] of [[line.points[0],line.points[1]],[line.points.at(-1),line.points.at(-2)]]) {
        if (!neighbor) continue;
        for (const card of cards) {
          let side;
          if (point[0] > card.left+1 && point[0] < card.right-1) {
            if (Math.abs(point[1]-card.top) < .1) side = 'top';
            if (Math.abs(point[1]-card.bottom) < .1) side = 'bottom';
          }
          if (point[1] > card.top+1 && point[1] < card.bottom-1) {
            if (Math.abs(point[0]-card.left) < .1) side = 'left';
            if (Math.abs(point[0]-card.right) < .1) side = 'right';
          }
          if (!side) continue;
          const normal = {top:[0,-1],bottom:[0,1],left:[-1,0],right:[1,0]}[side];
          const delta = neighbor.map((v,i) => v-point[i]);
          if (delta[0]*normal[0]+delta[1]*normal[1] <= 0 || delta[0]*normal[1]-delta[1]*normal[0] !== 0) badDirections.push({id:card.id,point,neighbor});
          contacts.push({...line,id:card.id,side,point});
        }
      }
    }
    const segments = paths.flatMap(p => FamilyConnectorRouting.segments(p.points,{group:p.group}));
    const overlap = segments.some((s,i) => segments.slice(i+1).some(t => s.group === t.group && s.group.startsWith('shared:') && FamilyConnectorRouting.overlapLength(s,t) > .01));
    const pending = [...document.querySelectorAll('.intermediate-node')].map(node => {
      const b = node.getBoundingClientRect(),x=(b.left+b.right)/2-origin.left,y=(b.top+b.bottom)/2-origin.top;
      return {near:node.dataset.near,text:node.textContent,label:node.getAttribute('aria-label'),onStroke:segments.some(s => s.axis === 'h'
        ? Math.abs(y-s.fixed)<1 && x>=s.min-1 && x<=s.max+1
        : Math.abs(x-s.fixed)<1 && y>=s.min-1 && y<=s.max+1)};
    });
    return {cards,paths,contacts,collisions,badDirections,overlap,pending};
  });
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'family-peer-sharing-'));
  const dataFile = path.join(temp,'family.json'),server = createFamilyServer({dataFile});
  const engine = process.env.PLAYWRIGHT_BROWSER || 'chromium';
  let browser;
  try {
    await fs.writeFile(dataFile,JSON.stringify(fixtures[0].data));
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await playwright[engine].launch({headless:true,...(engine === 'chromium' ? {channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'} : {})});
    for (const mode of ['api','static']) for (const width of [1440,390,844]) {
      const context = await browser.newContext({viewport:{width,height:width === 844 ? 390 : 1000},reducedMotion:'reduce'});
      await context.addInitScript(() => localStorage.setItem('family-tree:canvas-guide:v1','seen'));
      if (mode === 'static') {
        const html = await renderFamilyTreeHtml({browserStorage:true});
        await context.route(base+'/',route => route.fulfill({contentType:'text/html',body:html}));
      }
      const page = await context.newPage(),errors = [];
      page.on('pageerror',e => errors.push(e.message));
      await page.goto(base);
      await page.waitForFunction(() => FamilyApp?.snapshot?.()?.data);
      for (const fixture of fixtures) {
        const message = `${fixture.id}: ${engine} ${mode} ${width}`;
        await page.evaluate(data => FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),fixture.data);
        // Programmatic fixture import bypasses the form UI's accept() call.
        // Reload so its snapshot matches the persisted data before testing +.
        if (fixture.pending) await page.reload();
        await page.waitForFunction(count => document.querySelectorAll('.person').length === count,fixture.data.people.length);
        const snapshot = await page.evaluate(() => FamilyApp.snapshot());
        const state = await geometry(page),paths = state.paths.filter(p => p.kind === fixture.kind);
        assert.deepEqual(state.collisions,[],message+' avoids cards');
        assert.deepEqual(state.badDirections,[],message+' uses perpendicular outward ports');
        assert.equal(state.overlap,false,message+' paints shared strokes once');
        assert(state.paths.every(p => p.points.every(point => point[1] >= 0)),message+' stays inside canvas');
        assert.equal(new Set(paths.map(p => p.group)).size,fixture.groups,message+' uses proven groups only');
        const contacts = state.contacts.filter(c => c.kind === fixture.kind && c.id === fixture.root);
        if (fixture.members) {
          assert.equal(contacts.length,1,message+' has exactly one shared member exit');
          assert.deepEqual([...contacts[0].people].sort(),[...fixture.members].sort(),message+' trunk represents every branch');
          assert.equal(contacts[0].side,'top',message+' same-generation fork uses upper gutter');
          await page.locator('.person[data-person-id="A"]').evaluate(el => el.click());
          const highlighted = (await geometry(page)).paths.filter(p => p.kind === fixture.kind);
          assert(highlighted.some(p => p.people.length === 3 && p.opacity === '1'),message+' highlights shared trunk');
          assert(highlighted.some(p => !p.people.includes('A') && p.opacity === '0.12'),message+' dims the other branch');
          if (fixture.details) assert(highlighted.every(p => p.display !== 'none'),message+' reveals rank branches on selection');
          await page.locator('.person[data-person-id="A"]').evaluate(el => el.click());
        }
        if (fixture.inferred) {
          assert(paths.some(p => p.inferred && p.display === 'none'),message+' keeps inferred-only branch hidden in overview');
          assert(paths.some(p => p.people.length === 3 && !p.inferred && p.display !== 'none'),message+' keeps manual shared stem visible');
        }
        if (fixture.details) assert(paths.every(p => p.detailsOnly && p.display === 'none'),message+' hides rank branches in overview');
        if (fixture.pending) {
          const expected = new Set(Model.intermediatePlans(fixture.data).map(p => p.slotId)).size;
          assert.equal(state.pending.length,expected,message+' preserves every unique pending parent slot');
          assert(state.pending.every(p => p.text === '+' && p.label && p.onStroke),message+' keeps labeled + buttons attached to their connectors');
          await page.locator('.intermediate-node[data-near="C"]').evaluate(el => el.click());
          await page.locator('#member-dialog').waitFor({state:'visible'});
          assert.equal(await page.locator('.relation-target').inputValue(),'C',message+' + opens the correct parent form');
          assert.equal(await page.locator('.relation-kind').inputValue(),'親生',message+' + retains biological relationship');
          await page.locator('#cancel-member').click();
          await page.locator('#member-dialog').waitFor({state:'hidden'});
          assert.equal(await page.locator('.intermediate-node').count(),expected,message+' cancelling preserves pending slots');
        }
        if (fixture.opposite) assert.deepEqual(contacts.map(c => c.side).sort(),['bottom','top'],message+' preserves generation directions');
        assert.deepEqual(await page.evaluate(() => FamilyApp.snapshot()),snapshot,message+' does not mutate family data');
        if (process.env.PEER_SHARING_SCREENSHOTS && mode === 'api' && width === 1440) {
          await fs.mkdir(process.env.PEER_SHARING_SCREENSHOTS,{recursive:true});
          await page.locator('#tree-canvas').screenshot({path:path.join(process.env.PEER_SHARING_SCREENSHOTS,fixture.id+'-'+engine+'.png')});
        }
      }
      assert.deepEqual(errors,[],`${engine} ${mode} ${width}`);
      console.log(`PASS: peer sharing ${engine} ${mode} ${width} (${fixtures.length} cases)`);
      await context.close();
    }
  } finally {
    await browser?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(temp),base = path.resolve(os.tmpdir());
    assert(path.dirname(resolved) === base && path.basename(resolved).startsWith('family-peer-sharing-'),'cleanup stays in test temp directory');
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
