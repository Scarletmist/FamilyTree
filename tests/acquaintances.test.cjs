const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Projection = require('../src/assets/family-display-projection');
const Details = require('../src/assets/relationship-details');
const Evidence = require('../src/assets/relationship-evidence');
const Kinship = require('../src/assets/kinship').create(require('../src/data/kinship-terms.json'));
const p = (id, relationships = []) => ({ id, name: id, gender: 'U', location: '', position: '', siblingOrder: null, relationships });
const knows = personId => ({ type: 'acquaintance', personId });
const parent = personId => ({ type: 'parent', personId, kind: '親生' });
const project = people => Projection.project(Model.build({ schemaVersion: 3, people }));
const member = (graph, id) => graph.people.find(person => person.id === id);

test('acquaintances follow the known family generation in either record direction and input order', () => {
  for (const reverse of [false, true]) {
    const people = [p('G'), p('P', [parent('G')]), p('B', [parent('P'), ...(reverse ? [knows('A')] : [])]),
      p('A', reverse ? [] : [knows('B')]), p('X')];
    for (const ordered of [people, people.slice().reverse()]) {
      const original = structuredClone(ordered), graph = project(ordered);
      assert.equal(member(graph, 'A').gen, 3);
      assert.equal(member(graph, 'B').gen, 3);
      assert.equal(member(graph, 'A').nonFamily, true);
      for (const id of ['G', 'P', 'B', 'X']) assert.equal(member(graph, id).nonFamily, false);
      assert.equal(member(graph, 'X').gen, 1);
      assert.deepEqual(ordered, original);
      assert.equal(graph.bonds.filter(b => b.kind === '認識').length, 1);
      assert.equal(graph.bonds.some(b => b.kind === '契手足'), false);
      assert.deepEqual(Model.intermediatePlans({ schemaVersion: 3, people: ordered }), []);
      assert.equal(graph.inferredRelations.some(r => r.from === 'A' || r.personId === 'A'), false);
    }
  }
});

test('adding a family relation restores family membership and its own generation; removing it recalculates', () => {
  const people = [p('G'), p('P', [parent('G')]), p('B', [parent('P')]), p('A', [knows('B')])];
  for (const type of ['parent', 'child', 'grandparent', 'grandchild', 'spouse', 'sibling', 'swornSibling', 'tangCousin', 'biaoCousin', 'uncleAunt', 'nephewNiece']) {
    const relation = { type, personId: 'G', ...(Model.isDescent(type) ? {kind:'親生'} : {}) };
    const changed = [...people.slice(0, 3), p('A', [knows('B'), relation])];
    const withAcquaintance = project(changed), without = project([...people.slice(0, 3), p('A', [relation])]);
    assert.equal(member(withAcquaintance, 'A').gen, member(without, 'A').gen, type);
    assert.equal(member(withAcquaintance, 'A').nonFamily, false, type);
    assert.equal(member(withAcquaintance, 'B').gen, member(without, 'B').gen, type);
  }
  assert.equal(member(project(people), 'A').nonFamily, true);
});

test('acquaintance chains and multiple family contacts are deterministic and never shift relatives', () => {
  const people = [p('G'), p('P', [parent('G')]), p('B', [parent('P')]),
    p('A', [knows('B'), knows('P')]), p('C', [knows('A')]), p('Y', [knows('Z')]), p('Z')];
  const one = project(people), two = project(people.slice().reverse());
  for (const id of people.map(p => p.id)) assert.equal(member(one, id).gen, member(two, id).gen, id);
  assert.equal(member(one, 'A').gen, 2);
  assert.equal(member(one, 'C').gen, 2);
  assert.equal(member(one, 'B').gen, 3);
  assert.equal(member(one, 'G').gen, 1);
});

test('reverse editing, direct query, details and evidence preserve the acquaintance and its metadata', () => {
  const relation = { ...knows('B'), source: '活動', note: '同事' };
  const data = { schemaVersion: 3, people: [p('A', [relation]), p('B')] };
  const inverse = Model.relationshipsFor(data, 'B');
  assert.deepEqual(inverse, [{ ...relation, personId: 'A' }]);
  const edited = Model.replaceMember(data, { ...data.people[1], relationships: inverse });
  const graph = project(edited.people);
  for (const [from, to] of [['A', 'B'], ['B', 'A']]) {
    assert.equal(Kinship.query(graph, from, to).paths[0].title, '認識的人');
    const group = Details.buildGroups(graph, from).find(g => g.id === 'acquaintances');
    assert.equal(group.entries[0].personId, to);
    assert.equal(group.entries[0].role, '朋友');
    assert.equal(group.entries[0].missing.includes('未填性別'), false);
    assert.equal(Details.buildGroups(graph, from).some(g => g.id === 'siblings'), false);
    assert.equal(Evidence.create(graph).between(from, to, ['acquaintance'])[0].evidence.origin, 'direct');
  }
  assert.equal(Model.build(Model.replaceMember(edited, { ...edited.people[1], relationships: [] })).bonds.length, 0);
  assert.throws(() => Model.validateMember(p('A', [knows('A')])), /自己/);
  assert.throws(() => Model.validateMember(p('A', [knows('B'), knows('B')])), /重複/);
});

test('SVG and print cards preserve the non-family dashed border', async () => {
  const { diagramMarkup } = await import('../src/assets/family-tree-output.mjs');
  const scene = {width:400,height:200,bands:[],shapes:[],placeholders:[],nodes:[
    {id:'A',x:0,y:0,width:100,height:80,nonFamily:true,lines:[]},
    {id:'B',x:200,y:0,width:100,height:80,nonFamily:false,lines:[]}
  ]};
  const markup = diagramMarkup(scene);
  assert.equal((markup.match(/stroke-dasharray="6 4"/g) || []).length, 1);
});
