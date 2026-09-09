const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model.js');
const Details = require('../assets/relationship-details.js');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });

for (const kind of Model.KINDS) test(`${kind}: direct grandparent and inverse survive editing and display two generations apart`, () => {
  const data = { schemaVersion: 2, people: [person('G'), person('C', [{ type: 'grandparent', personId: 'G', kind }])] };
  const graph = Model.build(data);
  assert.deepEqual(graph.people.map(p => p.gen), [1, 3]);
  assert.equal(graph.descents[0].generations, 2);
  assert.equal(Details.buildGroups(graph, 'C')[0].id, 'grandparents');
  assert.equal(Details.buildGroups(graph, 'G')[0].id, 'grandchildren');
  if (kind === '契子女') assert.equal(Details.buildGroups(graph, 'C')[0].entries[0].role, '契祖父');
  const inverse = Model.relationshipsFor(data, 'G');
  assert.deepEqual(inverse, [{ type: 'grandchild', personId: 'C', kind }]);
  const edited = Model.replaceMember(data, { ...data.people[0], relationships: inverse });
  assert.equal(edited.people[1].relationships.length, 0);
  assert.deepEqual(Model.build(JSON.parse(JSON.stringify(edited))).descents, graph.descents);
  assert.equal(Model.build(Model.replaceMember(edited, { ...edited.people[0], relationships: [] })).descents.length, 0);
});

test('shared grandparents do not imply siblings or duplicate sibling orders; allow four grandparents', () => {
  const grandparents = ['A', 'B', 'C', 'D'].map(id => person(id));
  const relations = grandparents.map(p => ({ type: 'grandparent', personId: p.id, kind: '親生' }));
  const data = { schemaVersion: 2, people: [...grandparents, { ...person('E', relations), siblingOrder: 1 }, { ...person('F', relations), siblingOrder: 1 }] };
  const groups = Details.buildGroups(Model.build(data), 'E');
  assert.deepEqual(groups.map(g => g.id), ['grandparents']);
  assert.equal(groups[0].entries.length, 4);
});

test('direct grandparent agrees with a two-step path and rejects contradictory directions', () => {
  const data = { schemaVersion: 2, people: [person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]), person('C', [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'grandparent', personId: 'G', kind: '契子女' }])] };
  Model.build(data);
  data.people[2].relationships[1].type = 'grandchild';
  assert.throws(() => Model.build(data), /矛盾/);
  assert.throws(() => Model.validateMember(person('X', [{ type: 'grandparent', personId: 'G' }])), /類型/);
});
