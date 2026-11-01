const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Projection = require('../src/assets/family-display-projection');
const Details = require('../src/assets/relationship-details');
const Evidence = require('../src/assets/relationship-evidence');
const Diff = require('../src/assets/family-diff');
const Commands = require('../src/assets/family-commands');
const Kinship = require('../src/assets/kinship').create(require('../src/data/kinship-terms.json'));
const person = (id, gender = 'M', relationships = []) => ({ id, name: id, gender, location: '', position: '', siblingOrder: null, relationships });
const child = personId => ({ type: 'child', personId, kind: '親生' });
const cases = [
  ['叔父', 'M', 'paternal', 'younger', 'M'],
  ['伯父', 'M', 'paternal', 'older', 'M'],
  ['舅舅', 'M', 'maternal', 'unknown', 'F'],
  ['姑姑', 'F', 'paternal', 'unknown', 'M'],
  ['阿姨', 'F', 'maternal', 'unknown', 'F']
];
for (const [title, gender, lineage, seniority, parentGender] of cases) {
  test(`${title}: direct/inverse records, middle-parent completion, query and editing stay consistent`, async () => {
    const relation = { type: 'uncleAunt', personId: 'R', lineage, ...(seniority !== 'unknown' ? { seniority } : {}), source: '家族紀錄', note: '親生支系' };
    const data = { schemaVersion: 3, people: [person('C', 'F', [relation]), person('R', gender)] };
    const original = JSON.stringify(data);
    let graph = Projection.project(Model.build(data));
    assert.equal(graph.descents.length, 0);
    assert.equal(graph.people[0].gen, graph.people[1].gen + 1);
    assert.equal(Kinship.query(graph, 'R', 'C').paths[0].title, title);
    assert.equal(Details.buildGroups(graph, 'C').find(g => g.id === 'unclesAunts').entries[0].role, title);
    const inverse = Model.relationshipsFor(data, 'R');
    assert.deepEqual(inverse, [{ ...relation, type: 'nephewNiece', personId: 'C' }]);
    assert.equal(Kinship.query(graph, 'C', 'R').paths[0].title, lineage === 'paternal' ? '姪女' : '外甥女');
    const edited = Model.replaceMember(data, { ...data.people[1], relationships: inverse });
    assert.equal(Diff.compare(data, edited).total, 0);
    assert.equal(Evidence.create(graph).between('R', 'C')[0].relation.seniority, relation.seniority);
    const plans = Projection.intermediatePlans(data);
    assert.equal(plans.length, 1);
    const plan = plans[0];
    assert.equal(plan.gender, parentGender);
    assert.equal(plan.generation, graph.people[1].gen);
    assert.deepEqual(plan.relationships, [child('C'), { type: 'sibling', personId: 'R', ...(seniority !== 'unknown' ? { seniority } : {}) }]);
    const completed = Commands.apply(data, { type: 'addMember', requestId: '11111111-1111-4111-8111-111111111111', member: person('unused', plan.gender, plan.relationships) }).data;
    graph = Projection.project(Model.build(completed));
    assert.equal(Model.intermediatePlans(completed).filter(p => p.edgeKey.startsWith('叔伯姑姨舅|')).length, 0);
    assert(Model.completedAvuncular(graph).has(plan.edgeKey));
    assert.equal(Kinship.query(graph, 'R', 'C').paths[0].title, title);
    assert.deepEqual(graph.people[0].relationships, [relation]);
    const { createTreeLayout } = await import('../src/assets/family-tree-layout.mjs');
    const layout = createTreeLayout({graph, fullGraph: graph, connectedIds: new Set(graph.people.map(p => p.id)), intermediatePlans: Projection.intermediatePlans(completed), displayShift: 0, uncertainGeneration: 5, model: Model, orderKey: Model.orderKey});
    assert(!layout.extra.some(e => e.kind === '叔伯姑姨舅'));
    const focused = Kinship.project(graph, Kinship.query(graph, 'R', 'C').paths.find(p => p.edges.length === 1));
    assert.equal(Kinship.query(focused, 'R', 'C').paths[0].title, title);
    assert.equal(JSON.stringify(data), original);
    assert.equal(Model.build(Model.replaceMember(edited, {...edited.people[1], relationships: []})).bonds.length, 0);
  });
}
test('unknown branch stays ambiguous and conflicting reciprocal assertions or generations are rejected', () => {
  const data = {schemaVersion: 3, people:[person('C', 'M', [{type:'uncleAunt',personId:'R'}]),person('R')]};
  assert.equal(Kinship.query(Model.build(data),'R','C').paths[0].title,'叔伯／舅');
  assert.equal(Model.intermediatePlans(data)[0].gender,'U');
  assert.throws(() => Model.build({...data,people:[person('C','M',[{type:'uncleAunt',personId:'R',lineage:'invalid'}]),person('R')]}), /父系／母系/);
  data.people[0].relationships[0].lineage = 'paternal';
  data.people[1].relationships = [{type:'nephewNiece',personId:'C',lineage:'maternal'}];
  assert.throws(() => Model.build(data), /記錄互相矛盾/);
  data.people[1].relationships = [{type:'sibling',personId:'C'}];
  assert.throws(() => Model.build(data), /階層互相矛盾/);
});
test('existing biological parents are reused and adoptive parents cannot complete the branch', () => {
  const data = {schemaVersion: 3, people:[person('C','M',[{type:'uncleAunt',personId:'R',lineage:'maternal'}]),person('R'),person('P','F',[child('C')])]};
  let graph = Model.build(data);
  assert.equal(Model.intermediatePlans(data).length, 0);
  assert.equal(Model.completedAvuncular(graph).size, 0, 'self-derived siblings do not hide their direct source line');
  assert(graph.inferredRelations.some(r => r.from === 'P' && r.personId === 'R' && r.type === 'sibling'));
  data.people[2].relationships[0].kind = '養子女';
  graph = Model.build(data);
  assert.equal(Model.completedAvuncular(graph).size, 0);
  assert.equal(Model.intermediatePlans(data).length, 1);
});
test('a direct aunt applies to full siblings and her children but never to unrelated people', () => {
  const data = {schemaVersion: 3, people:[person('C','M',[{type:'uncleAunt',personId:'R',lineage:'maternal'},{type:'sibling',personId:'S'}]),person('R','F',[child('B')]),person('S'),person('B'),person('X')]};
  const graph = Model.build(data);
  assert(graph.inferredRelations.some(r => r.from === 'S' && r.personId === 'R' && r.type === 'uncleAunt'));
  assert(graph.inferredRelations.some(r => r.from === 'C' && r.personId === 'B' && r.type === 'biaoCousin'));
  assert(!graph.inferredRelations.some(r => r.from === 'X' || r.personId === 'X'));
});
test('one parent slot joins relatives on the same explicit branch and ignores/restores them together', () => {
  const data = {schemaVersion:3,people:[person('C','F',[
    {type:'uncleAunt',personId:'R',lineage:'paternal',seniority:'older'},
    {type:'uncleAunt',personId:'A',lineage:'paternal'},
    {type:'uncleAunt',personId:'B',lineage:'maternal'}]),person('R'),person('A','F'),person('B','F')]};
  const plans = Model.intermediatePlans(data);
  assert.equal(plans.length,3);
  assert.equal(new Set(plans.map(p => p.slotId)).size,2);
  const father = plans.find(p => p.gender === 'M');
  assert.equal(father.relationships.length,3);
  assert(father.relationships.some(r => r.personId === 'R' && r.seniority === 'older'));
  assert(father.relationships.some(r => r.personId === 'A' && r.type === 'sibling'));
  const ignored = Commands.apply(data,{type:'updateIntermediateIgnore',planId:father.id,ignored:true}).data;
  assert.equal(Model.intermediatePlans(ignored).length,1);
  const restored = Commands.apply(ignored,{type:'updateIntermediateIgnore',planId:father.id,ignored:false}).data;
  assert.equal(Model.intermediatePlans(restored).length,3);
  const completed = {...data,people:[...data.people,person('P','M',father.relationships)]};
  assert.equal(Model.completedAvuncular(Model.build(completed)).size,2);
  assert.equal(Model.intermediatePlans(completed).filter(p => p.edgeKey.startsWith('叔伯姑姨舅|')).length,1);
});
