// Mixed recorded/rank/inferred relationships share geometry, not visibility.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const Model = require('../src/assets/family-model.js');
const {createFamilyServer} = require('../dev/server.cjs');
const {renderFamilyTreeHtml} = require('../dev/site-source.cjs');
const person = (id,relationships=[]) => ({id,name:id,gender:'M',location:'',position:'',siblingOrder:null,relationships});
const parent = personId => ({type:'parent',personId,kind:'親生'});
const ids = ['A','B','C','D','E'];
function ranked(type,{teacher=false,parents=false,allDirect=false,overlap=false,crossGeneration=false}={}) {
  const cohorts = overlap ? [['A','B','C'],['C','D','E']] : [ids];
  const direct = overlap ? [['A','B'],['C','D']] : allDirect ? ids.flatMap((a,i) => ids.slice(i+1).map(b => [a,b])) : [['A','B'],['A','C']];
  return {schemaVersion:3,people:[...ids.map(id => person(id,[
    ...direct.filter(([a]) => a===id).map(([,personId]) => ({type,personId})),
    ...(teacher ? [{type:'teacher',personId:'T'}] : []),
    ...(parents && ['A','B','C'].includes(id) ? [parent('P')] : []),
    ...(crossGeneration && id==='B' ? [parent('A')] : []),
    ...(crossGeneration && id==='C' ? [parent('B')] : []),
    ...(crossGeneration && ['D','E'].includes(id) ? [{type:'spouse',personId:'A'}] : [])
  ])),...(teacher ? [person('T')] : []),...(parents ? [person('P')] : [])],
  rankGroups:cohorts.map((members,i) => ({id:'r'+i,type,name:'同名排行',members:members.map((personId,j) => ({personId,order:j+1}))}))};
}
const fixtures = [
  {id:'school-mixed',kind:'師兄弟姊妹',data:ranked('fellowDisciple')},
  {id:'school-mixed-known-teacher',kind:'師兄弟姊妹',data:ranked('fellowDisciple',{teacher:true})},
  {id:'siblings-mixed-pending',kind:'手足',data:ranked('sibling')},
  {id:'siblings-mixed-parent',kind:'手足',data:ranked('sibling',{parents:true})},
  {id:'sworn-mixed',kind:'契手足',data:ranked('swornSibling')},
  {id:'school-all-direct-also-ranked',kind:'師兄弟姊妹',data:ranked('fellowDisciple',{allDirect:true})},
  {id:'school-mixed-overlapping-sources',kind:'師兄弟姊妹',data:ranked('fellowDisciple',{overlap:true}),sources:[['A','B','C'],['C','D','E']]},
  {id:'school-mixed-family-generations',kind:'師兄弟姊妹',data:ranked('fellowDisciple',{crossGeneration:true}),generations:{A:1,B:2,C:3,D:1,E:1}},
  {id:'tang-recorded-inferred-pending',kind:'堂親',data:{schemaVersion:3,people:[
    person('A',[{type:'sibling',personId:'B'},{type:'tangCousin',personId:'C'}]),person('B'),person('C')
  ]},sources:[['A','B','C']]}
];

async function geometry(page,kind) {
  return page.evaluate(kind => {
    const root = document.getElementById('tree-canvas').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.person')].map(n => {
      const r=n.getBoundingClientRect();
      return {id:n.dataset.personId,gen:Number(n.closest('.generation').dataset.gen),left:r.left-root.left,right:r.right-root.left,top:r.top-root.top,bottom:r.bottom-root.top};
    });
    const info = n => ({group:n.dataset.group,people:n.dataset.people.split(' '),inferred:n.dataset.inferred==='true',detailsOnly:n.dataset.detailsOnly==='true',visible:n.style.display!=='none',opacity:n.style.opacity});
    const paths = [...document.querySelectorAll('#tree-connectors path[data-points]')].filter(n=>n.dataset.kind===kind)
      .map(n=>({...info(n),points:n.dataset.points.split(' ').map(p=>p.split(',').map(Number))}));
    const groups = new Set(paths.map(p=>p.group));
    const markers = [...document.querySelectorAll('#tree-connectors path[marker-end]:not([data-points])')].filter(n=>groups.has(n.dataset.group)).map(n=>{
      const end=n.getAttribute('d').match(/ L ([-\d.e+]+) ([-\d.e+]+)$/);
      return {...info(n),point:end ? end.slice(1).map(Number) : null};
    });
    const side = (p,c) => {
      if(p[0]>c.left+1 && p[0]<c.right-1) {
        if(Math.abs(p[1]-c.top)<.1)return 'top';if(Math.abs(p[1]-c.bottom)<.1)return 'bottom';
      }
      if(p[1]>c.top+1 && p[1]<c.bottom-1) {
        if(Math.abs(p[0]-c.left)<.1)return 'left';if(Math.abs(p[0]-c.right)<.1)return 'right';
      }
    };
    const contacts = paths.flatMap(p=>[p.points[0],p.points.at(-1)].flatMap(point=>cards.flatMap(c=>{
      const s=side(point,c);return s ? [{...p,id:c.id,side:s,point}] : [];
    })));
    const markerContacts = markers.filter(m=>m.point).flatMap(m=>cards.flatMap(c=>{
      const s=side(m.point,c);return s ? [{...m,id:c.id,side:s}] : [];
    }));
    const segments = paths.flatMap(p=>FamilyConnectorRouting.segments(p.points,{group:p.group}));
    const collisions = segments.flatMap(s=>cards.filter(c=>s.axis==='v'
      ? s.fixed>c.left+.5 && s.fixed<c.right-.5 && s.max>c.top+.5 && s.min<c.bottom-.5
      : s.fixed>c.top+.5 && s.fixed<c.bottom-.5 && s.max>c.left+.5 && s.min<c.right-.5).map(c=>c.id));
    const overlap = segments.some((a,i)=>segments.slice(i+1).some(b=>a.group===b.group && FamilyConnectorRouting.overlapLength(a,b)>.01));
    const pending = [...document.querySelectorAll('.intermediate-node')].map(n=>{
      const r=n.getBoundingClientRect(),x=(r.left+r.right)/2-root.left,y=(r.top+r.bottom)/2-root.top;
      return {text:n.textContent,onStroke:[...document.querySelectorAll('#tree-connectors path[data-points]')].some(p=>FamilyConnectorRouting.segments(p.dataset.points.split(' ').map(v=>v.split(',').map(Number))).some(s=>s.axis==='h'
        ? Math.abs(y-s.fixed)<1 && x>=s.min-1 && x<=s.max+1 : Math.abs(x-s.fixed)<1 && y>=s.min-1 && y<=s.max+1))};
    });
    return {cards,paths,contacts,markerContacts,overlap,collisions,pending};
  },kind);
}

function expectedContacts(fixture,scene) {
  const bonds=Model.build(fixture.data).bonds.filter(b=>b.kind===fixture.kind);
  const sources=fixture.sources || [ids],result=[];
  for(const source of sources) for(const id of source) {
    const person=scene.cards.find(c=>c.id===id),sides=new Map();
    for(const b of bonds.filter(b=>b.members.includes(id) && b.members.every(id=>source.includes(id)))) {
      const other=scene.cards.find(c=>c.id===b.members.find(p=>p!==id));
      const side=person.gen<other.gen ? 'bottom' : 'top';
      if(!sides.has(side))sides.set(side,{id,side,source,people:new Set(),overview:false,inferredView:false});
      const e=sides.get(side);b.members.forEach(p=>e.people.add(p));
      e.overview ||= !b.inferred && !b.rankGroupIds?.length;
      e.inferredView ||= !b.rankGroupIds?.length;
    }
    result.push(...sides.values());
  }
  return result;
}
const samePeople = (a,b) => [...a].sort().join() === [...b].sort().join();
function checkVisibility(scene,expected,view,message,selected) {
  for(const [name,contacts] of [['stroke',scene.contacts],['endpoint symbol',scene.markerContacts]]) {
    assert.equal(contacts.length,expected.length,message+' exactly one '+name+' per source and direction');
    for(const e of expected) {
      const matches=contacts.filter(c=>c.id===e.id && c.side===e.side && samePeople(c.people,e.people));
      assert.equal(matches.length,1,message+' correct '+name+' at '+e.id+' '+e.side);
      assert.equal(matches[0].visible,view==='details' || e[view],message+' visibility of '+name+' at '+e.id);
      if(selected)assert.equal(matches[0].opacity,e.people.has(selected)?'1':'0.12',message+' selected source highlighting');
    }
  }
  for(const p of scene.paths) {
    if(view==='overview' && (p.detailsOnly || p.inferred))assert(!p.visible,message+' overview hides exclusive tails');
    if(view==='inferredView' && p.detailsOnly)assert(!p.visible,message+' inferred toggle does not reveal rank-only tails');
  }
}

(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'family-mixed-sharing-'));
  const dataFile=path.join(temp,'family.json'),server=createFamilyServer({dataFile});
  const engine=process.env.PLAYWRIGHT_BROWSER || 'chromium';let browser;
  try {
    await fs.writeFile(dataFile,JSON.stringify(fixtures[0].data));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    browser=await playwright[engine].launch({headless:true,...(engine==='chromium'?{channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'}:{})});
    for(const mode of ['api','static'])for(const width of [1440,390,844]) {
      const context=await browser.newContext({viewport:{width,height:width===844?390:1000},reducedMotion:'reduce'});
      await context.addInitScript(()=>localStorage.setItem('family-tree:canvas-guide:v1','seen'));
      if(mode==='static') {
        const html=await renderFamilyTreeHtml({browserStorage:true});
        await context.route(base+'/',r=>r.fulfill({contentType:'text/html',body:html}));
      }
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.waitForFunction(()=>FamilyApp?.snapshot?.()?.data);
      for(const fixture of fixtures) {
        const message=`${fixture.id}: ${engine} ${mode} ${width}`;
        await page.evaluate(data=>FamilyApp.importFamily({data,version:FamilyApp.snapshot().version}),fixture.data);
        await page.waitForFunction(n=>document.querySelectorAll('.person').length===n,fixture.data.people.length);
        await page.evaluate(()=>{const b=document.getElementById('toggle-inferred-lines');if(b.getAttribute('aria-pressed')==='true')b.click();});
        const snapshot=await page.evaluate(()=>FamilyApp.snapshot()),overview=await geometry(page,fixture.kind);
        const expected=expectedContacts(fixture,overview);
        assert.equal(new Set(overview.paths.map(p=>p.group)).size,(fixture.sources || [ids]).length,message+' merges mixed visibility only within the same source');
        assert(!overview.overlap,message+' paints shared segments once');assert.deepEqual(overview.collisions,[],message+' avoids cards');
        assert(overview.paths.every(p=>p.points.every(([,y])=>y>=0)),message+' stays inside canvas');
        if(fixture.generations)for(const [id,gen]of Object.entries(fixture.generations))assert.equal(overview.cards.find(c=>c.id===id).gen,gen,message+' preserves family generations');
        const slots=new Set(Model.intermediatePlans(fixture.data).map(p=>p.slotId)).size;
        assert.equal(overview.pending.length,slots,message+' preserves pending + nodes');
        assert(overview.pending.every(p=>p.text==='+' && p.onStroke),message+' keeps + attached');
        checkVisibility(overview,expected,'overview',message);
        await page.evaluate(()=>document.getElementById('toggle-inferred-lines').click());
        checkVisibility(await geometry(page,fixture.kind),expected,'inferredView',message);
        await page.evaluate(()=>document.getElementById('toggle-inferred-lines').click());
        for(const id of [...new Set((fixture.sources || [ids]).flat())]) {
          await page.locator(`.person[data-person-id="${id}"]`).evaluate(n=>n.click());
          checkVisibility(await geometry(page,fixture.kind),expected,'details',message,id);
          if(process.env.MIXED_SHARING_SCREENSHOTS && mode==='api' && width===1440 && id==='A') {
            await fs.mkdir(process.env.MIXED_SHARING_SCREENSHOTS,{recursive:true});
            await page.locator('#tree-canvas').screenshot({path:path.join(process.env.MIXED_SHARING_SCREENSHOTS,fixture.id+'-'+engine+'.png')});
          }
          await page.locator(`.person[data-person-id="${id}"]`).evaluate(n=>n.click());
        }
        const restored=await geometry(page,fixture.kind);checkVisibility(restored,expected,'overview',message);
        assert.deepEqual(restored.paths,overview.paths,message+' restores exact overview geometry and visibility');
        assert.deepEqual(await page.evaluate(()=>FamilyApp.snapshot()),snapshot,message+' does not change stored relationships');
      }
      assert.deepEqual(errors,[],`${engine} ${mode} ${width}`);
      console.log(`PASS: mixed relationship sharing ${engine} ${mode} ${width} (${fixtures.length} cases)`);
      await context.close();
    }
  } finally {
    await browser?.close();if(server.listening)await new Promise(r=>server.close(r));
    const resolved=path.resolve(temp);
    assert(path.dirname(resolved)===path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('family-mixed-sharing-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
