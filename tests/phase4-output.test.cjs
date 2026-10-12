const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/assets/family-model.js');
const p = (id,relationships = [],extra = {}) => ({id,name:'姓名' + id,gender:'U',location:'',position:'',siblingOrder:null,relationships,...extra});
const parent = personId => ({type:'parent',personId,kind:'親生',source:'訪談來源',note:'說明 <安全> & "引號"'});
const modules = Promise.all([import('../src/assets/family-tree-scene.mjs'),import('../src/assets/family-tree-output.mjs')]);
const scene = () => ({width:2300,height:1200,bands:[{gen:1,top:0,height:400},{gen:2,top:400,height:800}],shapes:[],placeholders:[],nodes:[
  {id:'A',x:120,y:80,width:240,height:150,lines:[{text:'八十字的完整姓名'.repeat(10),size:20,bold:true,color:'#302c27'}]},
  {id:'B',x:900,y:500,width:240,height:150,lines:[{text:'OOO',size:20,bold:true,color:'#302c27'}]}
]});
test('archive bridges retain recorded two-step parent edges and exclude recycle data',async () => {
  const [S] = await modules;
  const graph = M.build({schemaVersion:3,people:[p('A'),p('P',[parent('A')],{archive:{archivedAt:'2026-10-11T00:00:00Z'}}),p('C',[parent('P')]),p('Z',[],{archive:{archivedAt:'2026-10-11T00:00:00Z'}})],recycleBin:[{id:'deleted',person:p('deleted'),deletedAt:'2026-10-11T00:00:00Z',incomingRelationships:[],groupReferences:[],ignoredPlans:[]}]}),before = structuredClone(graph);
  const out = S.projectOutputGraph(graph);
  assert.deepEqual(out.graph.people.map(p => p.id),['A','P','C']);assert.deepEqual([...out.bridges],['P']);
  assert(out.graph.descents.some(d => d.child === 'C'));assert(out.graph.descents.some(d => d.child === 'P'));
  assert(!out.graph.people.some(p => p.id === 'deleted'));assert.deepEqual(graph,before);
  assert(S.projectOutputGraph(graph,{includeArchived:true}).graph.people.some(p => p.id === 'Z'));
});
test('selected scope includes necessary real bridges and preserves disconnected terminals',async () => {
  const [S] = await modules;
  const graph = M.build({schemaVersion:3,people:[p('G'),p('P',[parent('G')]),p('C',[parent('P')]),p('U')]});
  const result = S.projectOutputGraph(graph,{ids:['G','C','U']});
  assert.deepEqual([...result.bridges],['P']);assert.equal(result.graph.people.length,4);
  assert(!result.graph.people.find(p => p.id === 'C').relationships.some(r => r.personId === 'G'));
});
test('sources escape XML and privacy suppresses free-text appendix',async () => {
  const [S,O] = await modules;
  const graph = M.build({schemaVersion:3,people:[p('A'),p('B',[parent('A')])]});
  assert.equal(S.buildSourceAppendix(graph,{hideNames:true}).length,0);
  const appendix = S.buildSourceAppendix(graph),svg = O.serializeSVG(scene(),{title:'<標題>',appendix});
  assert(svg.includes('&lt;標題&gt;'));assert(svg.includes('&lt;安全&gt; &amp; &quot;引號&quot;'));
  assert(!svg.includes('foreignObject'));assert(!svg.includes('data-person'));assert(!svg.includes('javascript:'));
  const text = svg.replace(/<[^>]*>/g,'');assert(text.includes('八十字的完整姓名'.repeat(10)),'all long-name text survives line wrapping');
});
test('A4/A3 pagination uses full size text with overlap, reachable links and bounded tiles',async () => {
  const [,O] = await modules;
  for (const paper of ['A4','A3']) for (const orientation of ['portrait','landscape']) {
    const result = O.paginateScene(scene(),{paper,orientation});
    assert(result.pages.length >= 1);
    for (const page of result.pages) {assert(page.width <= result.chartWidth);assert(page.height <= result.chartHeight);for (const target of Object.values(page.continues).filter(Boolean)) assert(result.pages.some(p => p.number === target));}
    for (const node of scene().nodes) assert(result.pages.some(p => node.x >= p.x && node.y >= p.y && node.x + node.width <= p.x + p.width && node.y + node.height <= p.y + p.height),'Each card remains complete in a printed page');
    const html = O.printDocument(scene(),{paper,orientation});assert.match(html,/font-size:12pt/);if (result.pages.some(p => Object.values(p.continues).some(Boolean))) assert.match(html,/續第/);for (const page of result.pages) assert(html.includes(`href="#page-${page.number}"`));assert(!html.includes('<script'));
  }
});
test('page cuts prefer gaps between cards and cannot loop on tall cards',async () => {
  const [,O] = await modules;
  const diagram = scene();diagram.nodes = [{...diagram.nodes[0],x:640,y:0,height:2100}];diagram.height = 2300;
  const result = O.paginateScene(diagram,{paper:'A4',orientation:'portrait'});assert(result.pages.length < 50);assert(result.pages.some(p => p.cutCards));
});
test('long family titles wrap and reserve space instead of covering the diagram',async () => {
  const [,O] = await modules,diagram = scene(),title = '長家族名稱'.repeat(16);
  diagram.width = 600;
  const svg = O.serializeSVG(diagram,{title});assert(svg.replace(/<[^>]+>/g,'').includes(title));assert(O.svgHeaderHeight(diagram,title) > 184);
  const normal = O.paginateScene(diagram,{orientation:'portrait'}),long = O.paginateScene(diagram,{orientation:'portrait',title});
  assert(long.headerHeight > normal.headerHeight);assert(long.chartHeight < normal.chartHeight);
  assert(O.printDocument(diagram,{title,orientation:'portrait'}).includes('<br>'));
});

test('print tiles retain crossing connectors and definitions while omitting distant geometry',async () => {
  const [,O] = await modules,diagram = scene();
  diagram.shapes = [
    {tag:'defs',attrs:{id:'markers'},children:[]},
    {tag:'path',attrs:{d:'M 0 40 H 300',id:'crossing'},bounds:{x:0,y:30,width:300,height:20}},
    {tag:'path',attrs:{d:'M 900 900 H 1000',id:'distant'},bounds:{x:890,y:890,width:120,height:20}}
  ];
  const html = O.diagramMarkup(diagram,{x:0,y:0,width:200,height:200});
  assert.match(html,/id="markers"/);assert.match(html,/id="crossing"/);assert.doesNotMatch(html,/id="distant"/);
});
test('portrait print legend preserves the same pixel-to-point scale as body text',async () => {
  const [,O] = await modules,diagram = scene(),options = {paper:'A4',orientation:'portrait'};
  const width = Math.min(720,O.paginateScene(diagram,options).chartWidth);
  assert(O.printDocument(diagram,options).includes(`viewBox="0 0 ${width} 100"`));
});

test('sparse pagination skips empty tiles and connects the remaining page numbers',async () => {
  const [,O] = await modules,diagram = scene();
  diagram.width = 6000;diagram.height = 3000;
  const result = O.paginateScene(diagram,{paper:'A4',orientation:'landscape'});
  assert(result.pages.length < result.rows * result.cols);
  for (const page of result.pages) {
    assert(diagram.nodes.some(n => n.x + n.width >= page.x && n.x <= page.x + page.width && n.y + n.height >= page.y && n.y <= page.y + page.height));
    for (const link of Object.values(page.continues).filter(Boolean)) assert(result.pages.some(p => p.number === link));
  }
});
