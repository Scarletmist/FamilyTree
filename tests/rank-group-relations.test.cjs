const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model');
const Details = require('../src/assets/relationship-details');
const Evidence = require('../src/assets/relationship-evidence');
const Projection = require('../src/assets/family-display-projection');
const Maintenance = require('../src/assets/family-maintenance');
const Kinship = require('../src/assets/kinship').create(require('../src/data/kinship-terms.json'));
const person = (id, gender = 'M', relationships = []) => ({ id, name: id, gender, relationships, siblingOrder: null, location: '', position: '' });
const group = (type, id = 'r', members = [{ personId: 'A', order: 1 }, { personId: 'B', order: 3 }]) => ({ id, name: id, type, members });
const data = (type, people = [person('A'), person('B', 'F')]) => ({ schemaVersion: 3, people, rankGroups: [group(type)] });

test('layout retains rank group IDs for source-based connector sharing', async () => {
  const {createTreeLayout} = await import('../src/assets/family-tree-layout.mjs');
  const source = data('fellowDisciple',[person('A'),person('B'),person('C')]);
  source.rankGroups[0].members.push({personId:'C',order:4});
  const graph = Projection.project(Model.build(source));
  const layout = createTreeLayout({graph,fullGraph:graph,connectedIds:new Set(['A','B','C']),intermediatePlans:[],displayShift:0,uncertainGeneration:2,model:Model,orderKey:()=>Infinity});
  assert(layout.extra.every(e => e.detailsOnly && e.rankGroupIds[0] === 'r'));
  assert.equal(new Set(layout.sharing.map(s => s.group)).size,1);
  layout.extra[0].rankGroupIds.push('display-only-copy');
  assert(graph.bonds.every(b => b.rankGroupIds.length === 1));
});

test('each rank group derives peer bonds and ranked detail roles without changing source records', () => {
  for (const [type, kind, category, role] of [
    ['sibling', '手足', 'siblings', '三妹'],
    ['swornSibling', '契手足', 'siblings', '契三妹'],
    ['fellowDisciple', '師兄弟姊妹', 'fellowDisciples', '師妹']
  ]) {
    const source = data(type), original = structuredClone(source);
    const graph = Model.build(source);
    assert.deepEqual(graph.bonds, [{ members: ['A', 'B'], kind, inferred: true, rankGroupIds: ['r'] }]);
    assert.equal(Details.buildGroups(graph, 'A').find(g => g.id === category).entries[0].role, role);
    assert.equal(Kinship.query(graph, 'B', 'A').paths[0].title, role);
    assert.equal(graph.mentorships.length, 0);
    assert.equal(graph.descents.length, 0);
    assert.deepEqual(Model.relationshipsFor(source, 'A'), []);
    assert.deepEqual(Model.completeKinship(source), original, 'group links must not become biological inference premises or saved relationships');
    assert.deepEqual(source, original);
  }
});

test('rank group evidence names the group and both ranks instead of inventing a source relationship', () => {
  const graph = Model.build(data('swornSibling'));
  const [proof] = Evidence.create(graph).between('B', 'A', ['swornSibling']);
  assert.equal(proof.evidence.origin, 'inferred');
  assert.equal(proof.evidence.records.length, 0);
  assert.deepEqual(proof.evidence.premises[0].rankGroup, { id: 'r', name: 'r', type: 'swornSibling', fromOrder: 3, toOrder: 1 });
  assert.equal(proof.evidence.premises[0].records.length, 0);
  const path = Kinship.query(graph, 'A', 'B').paths[0];
  assert.equal(Evidence.create(graph).path(path.edges).premises[0].rankGroup.name, 'r');
  assert.equal(Details.buildGroups(graph, 'A').find(g => g.id === 'siblings').entries[0].proofs.length, 1);
});

test('multiple shared groups retain separate proofs and query roles but only one visual bond', () => {
  const source = data('fellowDisciple');
  source.rankGroups.push(group('fellowDisciple', 'other', [{ personId: 'A', order: 4 }, { personId: 'B', order: 2 }]));
  const graph = Model.build(source);
  assert.equal(graph.bonds.length, 1);
  assert.deepEqual(graph.bonds[0].rankGroupIds, ['r', 'other']);
  const proofs = Evidence.create(graph).between('A', 'B', ['fellowDisciple']);
  assert.deepEqual(proofs.map(p => p.evidence.premises[0].rankGroup.name), ['r', 'other']);
  assert.deepEqual(new Set(Kinship.query(graph, 'B', 'A').paths.map(p => p.title)), new Set(['師姊', '師妹']));
  source.rankGroups = [];
  assert.equal(Model.build(source).bonds.length, 0, 'removing the groups retracts all group links');
});

test('direct relationships take precedence and remain direct when also ranked in a group', () => {
  const source = data('sibling', [person('A', 'M', [{ type: 'sibling', personId: 'B' }]), person('B', 'F')]);
  const graph = Model.build(source);
  assert.deepEqual(graph.bonds, [{ members: ['A', 'B'], kind: '手足' }]);
  assert.equal(Evidence.create(graph).between('A', 'B', ['sibling'])[0].evidence.origin, 'direct');
  assert.equal(Kinship.query(graph, 'B', 'A').paths.length, 1);
});

test('group membership with unknown ranks connects peers, never the optional anchor or other groups', () => {
  const source = data('sibling', [person('A'), person('B'), person('T'), person('C')]);
  source.rankGroups[0].anchorId = 'T';
  source.rankGroups[0].members[1].order = null;
  source.rankGroups.push(group('sibling', 'single', [{ personId: 'C', order: 1 }]));
  const graph = Model.build(source);
  assert.equal(graph.bonds.length, 1);
  assert.deepEqual(graph.bonds[0].members, ['A', 'B']);
  assert.equal(Kinship.query(graph, 'C', 'A').status, 'unconnected');
  assert.equal(Kinship.query(graph, 'T', 'A').status, 'unconnected');
  assert.equal(Model.intermediatePlans(source).length, 0, 'group membership does not suggest fabricated parents');
  assert.deepEqual([...Model.relationshipMemberIds(graph.people, graph.bonds)].sort(), ['A', 'B']);
  assert.deepEqual(Maintenance.tasks(source).items.filter(item => item.category === 'unlinked').map(item => item.id).sort(), ['C', 'T']);
});

test('query projections keep group links derived and preserve independent family generations', () => {
  const source = data('sibling', [person('A'), person('B', 'F', [{ type: 'parent', personId: 'A', kind: '親生' }])]);
  const graph = Projection.project(Model.build(source));
  assert.deepEqual(graph.people.map(p => p.gen), [1, 2], 'group rank cannot override recorded ancestry');
  const path = Kinship.query(graph, 'B', 'A').paths.find(p => p.edges.some(e => e.rankGroup));
  assert(path);
  const projected = Kinship.project(graph, path);
  assert(projected.people.every(p => p.relationships.length === 0));
  assert(projected.bonds[0].inferred);
  assert.equal(Evidence.create(projected).between('A', 'B', ['sibling'])[0].evidence.origin, 'inferred');
});

test('rank-only and recorded shared-parent strokes can use the same routing cohort', () => {
  const graph = { people: [], bonds: [], unions: [{ id:'u', partners:['P'] }],
    descents:['A','B','C'].map(child => ({ union:'u', child, kind:'親生' })), mentorships:[] };
  const groups = Model.connectorGroups(graph, [
    { from:'A', to:'B', kind:'手足' }, { from:'A', to:'C', kind:'手足', inferred:true, detailsOnly:true }
  ]);
  assert.equal(groups[0].group, groups[1].group, 'interval visibility preserves recorded strokes while hiding rank-only tails');
});

test('group proofs coexist with recorded shared-parent evidence', () => {
  const source = data('sibling', [person('A','M',[{ type:'parent', personId:'P', kind:'親生', source:'家譜' }]),
    person('B','F',[{ type:'parent', personId:'P', kind:'親生' }]), person('P')]);
  const proofs = Evidence.create(Model.build(source)).between('A', 'B', ['sibling']);
  assert.equal(proofs.length, 2);
  assert(proofs.some(proof => proof.evidence.premises.some(step => step.rankGroup)));
  assert(proofs.some(proof => proof.evidence.records.some(record => record.relation.source === '家譜')));
});

test('changing a group updates its type and ranks without deriving the members children as cousins', () => {
  const source = data('sibling', [person('A'), person('B','F'),
    person('C','M',[{ type:'parent', personId:'A', kind:'親生' }]),
    person('D','F',[{ type:'parent', personId:'B', kind:'親生' }])]);
  assert.equal(Model.build(source).inferredRelations.length, 0);
  source.rankGroups[0].type = 'fellowDisciple';
  source.rankGroups[0].members[1].order = 5;
  const graph = Model.build(source);
  assert.equal(graph.bonds[0].kind, '師兄弟姊妹');
  assert.equal(Evidence.create(graph).between('A','B',['fellowDisciple'])[0].evidence.premises[0].rankGroup.toOrder, 5);
  assert.equal(Model.build(Model.completeKinship(source)).inferredRelations.length, 0);
});
